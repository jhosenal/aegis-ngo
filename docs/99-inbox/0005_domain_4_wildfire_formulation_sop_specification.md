# AEG-FRM-004: Domain 4 — Environmental & Wildfire Events (Thermal Anomalies) Formulation & SOP Specification

**Document Reference:** AEG-FRM-004

**Classification:** Formulation & SOP Specification / Open Autonomous Governance (OAG)

**Status:** Approved

**Author:** Systems Architect / CTO Office

**Target Engine:** Aegis NGO Deterministic Formulation Engine (`src/registry/formulations/wildfire.ts`)

## 1. Executive Summary

Domain 4 governs sudden-onset environmental and thermal emergencies, specifically active wildfires and severe thermal anomalies tracked via satellite telemetry. Unlike subterranean seismic events or hydrological floods, wildfires represent rapid aerodynamic-thermal hazards governed by wind vectors, fuel dryness, and terrain topography. 

This specification defines the exact mathematical equations, data normalization rules from **NASA FIRMS (MODIS/VIIRS)** and **NOAA meteorological feeds**, Sphere Project survival shortfalls, and deterministic Standard Operating Procedure (SOP) state gates executed by the Aegis NGO engine.

## 2. Normalized Data Variable Register

All incoming variables are ingested from zero-cost open public feeds, parsed, and mapped into canonical Aegis data structures before evaluation.

| Symbol | Parameter Description | Source Feed | Canonical Unit |
| :--- | :--- | :--- | :--- |
| $FRP$ | Fire Radiative Power | NASA FIRMS API | Megawatts ($\text{MW}$) |
| $v_{\text{wind}}$ | Local Sustained Wind Speed | NOAA Weather Feed | Kilometers per hour ($\text{km/h}$) |
| $\theta_{\text{wind}}$ | Wind Direction Angle Relative to Settlement | NOAA Weather Vector | Degrees ($0^\circ \text{ to } 360^\circ$) |
| $D_{\text{urban}}$ | Shortest Euclidian Distance to Residential Boundary | GIS Spatial Mapping Engine | Kilometers ($\text{km}$) |
| $D_i$ | Drought / Fuel Moisture Index | Global Drought Observatory | Scalar ($0.0 \text{ to } 1.0$) |
| $P_0$ | Baseline Settlement Population in Impact Zone | UN OCHA / HDX Grid | Count |

## 3. Core Mathematical Formulations

### 3.1 Fire Forward Spread Velocity ($V_{\text{spread}}$)
Surface fire propagation velocity is modeled using a Rothermel-inspired semi-empirical equation scaling non-linearly with wind velocity, fire radiative power, and fuel dryness:

$$V_{\text{spread}}(FRP, v_{\text{wind}}, D_i) = 0.04 \cdot v_{\text{wind}}^{1.2} \cdot \left( \frac{\max(10, FRP)}{50.0} \right)^{0.4} \cdot (1.0 + 1.5 \cdot D_i) \quad [\text{km/h}]$$

*Constraint:* If $v_{\text{wind}} < 0$, $v_{\text{wind}} = 0$. If $D_i > 1.0$, $D_i = 1.0$.

### 3.2 Time-to-Impact ($TTI$)
To determine when evacuation warnings transition to mandatory execution orders, the engine calculates the time required for the fire front to reach the nearest population cluster:

$$TTI = \frac{D_{\text{urban}}}{V_{\text{spread}}} \quad [\text{Hours}]$$

*Constraint:* If $TTI \le 0$, the fire front has breached the residential boundary (`BREACHED` status).

### 3.3 Plume Exposure & Affected Population ($P_{\text{aff}}$)
Smoke toxicity affects regional populations downwind across a broader area than the physical burn scar. Affected population exposure is modeled via a Gaussian dispersion approximation:

$$P_{\text{aff}} = P_0 \cdot \min\left(1.0, \, \frac{0.15 \cdot FRP}{D_{\text{urban}}^2 + 1} \right) \cdot (1.0 + 0.5 \cdot D_i)$$

### 3.4 Sphere Standard Emergency Shortfalls ($\Delta R$)
Wildfire crises prioritize respiratory protection, burn trauma care, and evacuation logistics over heavy water distribution:

1. **Respiratory Protection (N95 / P100 Particulate Masks):**
   $$\Delta R_{\text{masks}} = P_{\text{aff}} \cdot 3.0 \quad [\text{Mask Units}]$$
2. **Emergency Eye Wash & Saline Kits:**
   $$\Delta R_{\text{saline}} = \left\lceil P_{\text{aff}} \cdot 0.1 \right\rceil \quad [\text{Units}]$$
3. **Burn Care & Trauma Dressings:**
   $$\Delta R_{\text{burn}} = \left\lceil P_{\text{aff}} \cdot 0.002 \right\rceil \quad [\text{Specialized Burn Kits}]$$
4. **Evacuation Shelter Coterie Kits:**
   $$\Delta R_{\text{shelter}} = \left\lceil \frac{P_{\text{aff}}}{4.0} \right\rceil \quad [\text{Coterie Units}]$$

## 4. Deterministic SOP State Machine & Threshold Gates

```
                  [ Ingest NASA FIRMS Event ]
                               │
                               ▼
                Calculate V_spread, TTI & P_aff
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
       TTI > 24h        6h < TTI ≤ 24h       TTI ≤ 6h
       (LEVEL 0)         (LEVEL 1)         (LEVEL 2/3)
            │                  │                  │
            ▼                  ▼                  ▼
     THERMAL WATCH       ADVANCE WARNING    PERIMETER THREAT
```

### SOP Action Matrix

| State Level | Trigger Condition | Deterministic Engine Action | Automated Governance Output |
| :--- | :--- | :--- | :--- |
| **LEVEL 0: THERMAL WATCH** | $FRP < 50\text{ MW} \text{ AND } D_{\text{urban}} > 20\text{km}$ | Log thermal anomaly; suppress active alerts. | Internal audit log entry only. |
| **LEVEL 1: ADVANCE WARNING** | $50\text{ MW} \le FRP < 200\text{ MW} \text{ AND } 6\text{h} < TTI \le 24\text{h}$ | Instantiate wildfire monitoring card; verify air quality indices. | Open `CARD_WILDFIRE_WATCH` |
| **LEVEL 2: PERIMETER THREAT** | $TTI \le 6\text{ hours} \text{ AND } D_{\text{urban}} \le 10\text{km}$ | Trigger preemptive evacuation workflows; calculate mask shortfalls ($\Delta R$). | Open `CARD_DISPATCH_EVAC` |
| **LEVEL 3: CRITICAL INTERFACE FIRE** | $TTI \le 2\text{ hours} \text{ OR } P_{\text{aff}} \ge 10,000$ | Issue emergency public safety override; execute cross-agency OAG dispatch. | Execute `WORKFLOW_OAG_WILDFIRE_ALERT` |

## 5. Formal Mathematical Proof of Determinism

**Theorem:** Given identical NASA FIRMS telemetry $(FRP, v_{\text{wind}}, D_i, D_{\text{urban}})$ and baseline population $P_0$, the Aegis formulation engine shall produce bit-identical output vectors $(\Delta R_{\text{masks}}, \Delta R_{\text{burn}}, \text{SOP State})$ across all compute nodes.

**Proof:**
1. All mathematical operations ($V_{\text{spread}}$, $TTI$, $P_{\text{aff}}$) rely exclusively on standard arithmetic, exponential, and rounding functions conforming to IEEE 754 floating-point standards.
2. No stochastic variables, random seeds, or unseeded probabilistic calls exist within `src/registry/formulations/wildfire.ts`.
3. LLM reasoning layers are strictly decoupled from threshold calculation gates; text generation occurs only downstream during human-in-the-loop report formatting.
4. Therefore, $\forall x \in \text{Inputs}, \, f(x) \equiv f(x)$ across distributed worker nodes, preserving cryptographic audit chain integrity. Q.E.D.