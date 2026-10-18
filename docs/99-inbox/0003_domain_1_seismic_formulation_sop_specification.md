# AEG-FRM-001: Domain 1 — Seismic Events (Earthquakes & Tsunamis) Formulation & SOP Specification

**Document Reference:** AEG-FRM-001  
**Classification:** Formulation & SOP Specification / Open Autonomous Governance (OAG)  
**Status:** Approved  
**Author:** Systems Architect / CTO Office  
**Target Engine:** Aegis NGO Deterministic Formulation Engine (`src/registry/formulations/seismic.ts`)  

---

## 1. Executive Summary

This document establishes the production-grade mathematical formulations, data integration schemas, and Standard Operating Procedure (SOP) state gates for **Domain 1: Seismic Events (Earthquakes & Tsunamis)** within the Aegis NGO platform.

Aegis NGO operates on a strict **"Code Decides, Models Speak"** architecture. All threat thresholds, structural exposure estimates, and humanitarian resource shortfalls are calculated using pure, deterministic mathematical functions. Generative AI models (e.g., Gemini) are completely isolated from decision gates and function solely as natural language interfaces to explain state outputs and draft human-in-the-loop operational reports.

---

## 2. Ingestion Feeds & Normalized Variable Register

Seismic events ingest continuous real-time feeds from the **USGS Earthquake API** (GeoJSON) and baseline demographic datasets from **UN OCHA / HDX** and **Google Open Buildings**.

### 2.1 External Feed Integration Schemas

* **USGS Earthquake Endpoint:** `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson`
* **UN OCHA / HDX Demographic API:** Admin-level population density raster grids ($\rho(x, y)$)
* **Google Open Buildings (via HDX):** Building footprint polygon density ($D_{\text{bldg}}$) and structural roof area

### 2.2 Canonical Input Variable Definitions

| Symbol | Parameter Description | Source Field / API | Canonical Unit | Domain / Bounds |
| :---: | :--- | :--- | :---: | :---: |
| $M_w$ | Moment Magnitude | USGS `properties.mag` | Scalar | $[0.0, 10.0]$ |
| $d$ | Hypocentral Depth | USGS `geometry.coordinates[2]` | $\text{km}$ | $[0.0, 700.0]$ |
| $(\lambda_e, \phi_e)$ | Epicenter Coordinates (Lat, Long) | USGS `geometry.coordinates[0,1]` | Decimal Degrees | $[-90, 90], [-180, 180]$ |
| $R$ | Epicentral Distance to Settlement | Haversine Distance $(\lambda_e, \phi_e) \to (\lambda_s, \phi_s)$ | $\text{km}$ | $[0.0, \infty)$ |
| $h_{\text{ocean}}$ | Ocean Water Depth at Epicenter | GEBCO / NOAA Bathymetry | $\text{m}$ | $[0.0, 11000.0]$ |
| $P_0$ | Baseline Settlement Population | UN OCHA / HDX Grid | Count | $\mathbb{Z}_{\ge 0}$ |
| $V_{\text{struct}}$ | Regional Building Vulnerability Index | UN-HABITAT Composite Index | Scalar | $[0.5, 2.0]$ |
| $C_{\text{coping}}$ | Local NGO Coping Capacity Index | INFORM Risk Index | Scalar | $[0.1, 1.0]$ |

---

## 3. Core Mathematical Formulations

### 3.1 Wave Attenuation & Peak Ground Acceleration (PGA)

Ground shaking severity degrades as seismic energy propagates from the hypocenter. Aegis implements a modified Esteva-Villaverde attenuation relationship calibrated for hypocentral depth $d$ and epicentral distance $R$:

$$PGA(M_w, R, d) = \frac{5.6 \cdot 10^{0.87 \cdot M_w}}{(R + d + 25)^{2.0}} \cdot \gamma(d) \quad [g]$$

Where the deep-focus attenuation damping factor $\gamma(d)$ is defined as:

$$\gamma(d) = \begin{cases} 
1.0 & \text{if } d \le 300\text{ km} \\
\frac{1}{1 + 0.003 \cdot (d - 300)} & \text{if } d > 300\text{ km}
\end{cases}$$

*Constraint:* $PGA \ge 0.0 \text{ } g$.

---

### 3.2 Macroseismic Intensity (Modified Mercalli Intensity - MMI)

To translate ground acceleration into structural damage probability, $PGA$ is converted to $MMI$ using the Wald empirical transformation equations:

$$MMI(PGA) = \begin{cases} 
2.20 + 3.66 \cdot \log_{10}(PGA \cdot 980) & \text{if } \log_{10}(PGA \cdot 980) \le 1.66 \\
3.47 + 2.35 \cdot \log_{10}(PGA \cdot 980) & \text{if } \log_{10}(PGA \cdot 980) > 1.66 
\end{cases}$$

*Boundaries:* $MMI$ values are clamped to the closed interval $[I, XII]$.

---

### 3.3 Structural Damage Exposure & Affected Population ($P_{\text{aff}}$)

The fraction of the population exposed to destructive ground motion ($MMI \ge \text{VI}$, corresponding to $PGA \ge 0.09g$) is determined via a sigmoid exposure function:

$$F_{\text{exposed}}(PGA) = \frac{1}{1 + e^{-28 \cdot (PGA - 0.12)}}$$

The total affected population $P_{\text{aff}}$ across all affected administrative nodes $N$ within radius $R_{\text{impact}}$ is:

$$P_{\text{aff}} = \sum_{j \in N} \Big( P_{0, j} \cdot F_{\text{exposed}}(PGA_j) \cdot V_{\text{struct}, j} \Big)$$

---

### 3.4 Tsunami Generation Probability ($T_{\text{risk}}$) & Initial Wave Height ($H_0$)

For earthquakes occurring in marine or coastal environments (distance to coast $R_{\text{coast}} \le 50\text{ km}$), tsunami probability and initial vertical displacement ($H_0$) are calculated using Ward's shallow-fault ocean displacement model:

$$T_{\text{risk}}(M_w, d, R_{\text{coast}}) = \begin{cases} 
0.0 & \text{if } d \ge 70\text{ km} \text{ or } M_w < 6.5 \text{ or } R_{\text{coast}} > 50\text{ km} \\
\frac{1}{1 + e^{-3.5 \cdot (M_w - 7.2)}} & \text{otherwise}
\end{cases}$$

$$H_0 = \begin{cases}
0.0 & \text{if } T_{\text{risk}} < 0.10 \\
0.02 \cdot 10^{\left(0.5 \cdot M_w - 0.75 \cdot \log_{10}(d)\right)} \quad [\text{meters}] & \text{if } T_{\text{risk}} \ge 0.10
\end{cases}$$

---

### 3.5 Sphere Standard Shortfall Equations

Once $P_{\text{aff}}$ is determined, emergency resource demand vector $\vec{D}$ is calculated deterministically using international **Sphere Project Minimum Standards**:

$$\vec{D} = \begin{bmatrix} D_{\text{water}} \\ D_{\text{shelter}} \\ D_{\text{med}} \\ D_{\text{food}} \end{bmatrix} = \begin{bmatrix} 
P_{\text{aff}} \cdot 15.0 & [\text{Liters / Day}] \\
\left\lceil \frac{P_{\text{aff}}}{5.0} \right\rceil & [\text{Tarpaulins / Family Kits}] \\
\left\lceil P_{\text{aff}} \cdot 0.008 \right\rceil \cdot \frac{1}{C_{\text{coping}}} & [\text{Trauma IEHK Kits}] \\
P_{\text{aff}} \cdot 2100 & [\text{kcal / Day}]
\end{bmatrix}$$

Net Resource Shortfall Vector $\vec{R}$ is calculated against available localized warehouse inventory stock $\vec{I}$:

$$\vec{R} = \max\left(\vec{0}, \vec{D} - \sum_{k \in \text{Depots}} \vec{I}_k\right)$$

---

## 4. Deterministic SOP State Machine & Trigger Gates

```
                    [ Ingest USGS Seismic Event Payload ]
                                      │
                                      ▼
                        Compute PGA, MMI, P_aff, T_risk
                                      │
             ┌────────────────────────┼────────────────────────┐
             ▼                        ▼                        ▼
       PGA < 0.05g          0.05g ≤ PGA < 0.15g           PGA ≥ 0.15g
     (LEVEL 0: NOMINAL)      (LEVEL 1: WATCH)         (LEVEL 2 or 3: ALERT)
             │                        │                        │
             ▼                        ▼                        ▼
      Log Telemetry &         Instantiate Workspace     Evaluate P_aff Gate
      Suppress Alerts         Poll Local Inventories   ┌───────┴───────┐
                                                       ▼               ▼
                                                P_aff < 10,000   P_aff ≥ 10,000
                                                   (LEVEL 2)       (LEVEL 3)
```

### 4.1 SOP Operational State Table

| State Level | Trigger Threshold | Automated Engine Workflow | Governance Output |
| :--- | :--- | :--- | :--- |
| **LEVEL 0: NOMINAL** | $PGA < 0.05g$ | Suppress workspace creation; log event payload hash into audit buffer. | Audit Log Entry |
| **LEVEL 1: WATCH** | $0.05g \le PGA < 0.15g$ | Instantiate `SEISMIC_INCIDENT_WORKSPACE`; poll inventory depots within $R \le 100\text{ km}$. | Card: `CARD_SEISMIC_WATCH` |
| **LEVEL 2: LOCAL ALERT** | $PGA \ge 0.15g \text{ AND } P_{\text{aff}} < 10,000$ | Lock regional warehouse inventory; generate local dispatch routes; calculate $\vec{R}$. | Card: `CARD_DISPATCH_LOCAL` |
| **LEVEL 3: RED ALERT** | $PGA \ge 0.15g \text{ AND } P_{\text{aff}} \ge 10,000$ OR $T_{\text{risk}} > 0.70$ | Trigger international aid allocation; generate cryptographically signed OAG emergency appeal ledger item. | Workflow: `WORKFLOW_OAG_RED_ALERT` |

---

## 5. Formal Mathematical Proof of Determinism

**Theorem:** *Given an identical seismic event payload $E$ and state snapshot $S$, the Aegis Formulation Function $f_{\text{seismic}}(E, S)$ produces an invariant output state tuple $(PGA, MMI, P_{\text{aff}}, \vec{R}, \text{StateLevel})$ across all execution environments.*

**Proof:**
1. Let $E = \{ M_w, d, \lambda_e, \phi_e \}$ be the canonical JSON representation of the USGS event payload, normalized via `src/engine/canonical.ts`.
2. The distance function $\text{Haversine}(\lambda_e, \phi_e, \lambda_s, \phi_s)$ is deterministic over IEEE 754 double-precision floating-point arithmetic.
3. The functions $PGA(M_w, R, d)$, $MMI(PGA)$, $F_{\text{exposed}}(PGA)$, and $\vec{D}(P_{\text{aff}})$ contain no stochastic variables, random seeds, or external model calls.
4. The operations $\max()$, $\left\lceil \right\rceil$, and state machine evaluation against fixed threshold constants yield a unique mapping $E \to \text{StateLevel}$.
5. Therefore, $f_{\text{seismic}}(E, S)$ is purely deterministic and zero-token invariant. $\blacksquare$

---

## 6. Implementation Checklist

- [x] Document mathematical specification in `AEG-FRM-001`.
- [ ] Implement formulation calculations in `src/registry/formulations/seismic.ts`.
- [ ] Add unit tests verifying PGA, MMI, and shortfall outputs against USGS historical benchmarks (e.g., 2023 Türkiye $7.8 M_w$ earthquake).
- [ ] Wire SOP state transition rules to `src/services/workflowEngine.ts`.