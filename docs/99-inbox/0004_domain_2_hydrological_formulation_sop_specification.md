# AEG-FRM-002: Domain 2 — Hydrological Events (Floods, Flash Flooding & Inundation) Formulation & SOP Specification

**Document Reference:** AEG-FRM-002

**Classification:** Formulation & SOP Specification / Open Autonomous Governance (OAG)

**Status:** Approved

**Author:** Systems Architect / CTO Office

**Target Engine:** Aegis NGO Deterministic Formulation Engine (`src/registry/formulations/hydrological.ts`)

## 1. Executive Summary

This document establishes the production-grade mathematical formulations, data integration schemas, and Standard Operating Procedure (SOP) state gates for **Domain 2: Hydrological Events (Floods, Flash Flooding & Inundation)** within the Aegis NGO platform.

Operating under the **"Code Decides, Models Speak"** paradigm, Aegis calculates all flood exposure indices, water contamination severity multipliers, and Sphere Project WASH (Water, Sanitation, and Hygiene) shortfalls using deterministic pure functions. Generative AI layers are restricted from modifying threshold gates or resource calculations.

## 2. Ingestion Feeds & Normalized Variable Register

Hydrological events process multi-spectral satellite inundation layers, river gauge telemetry, and weather radar feeds combined with baseline human settlement datasets.

### 2.1 External Feed Integration Schemas

* **GDACS Flood Alerts API:** Global flood extent vectors and hazard alert levels.
* **Copernicus Emergency Management Service (EMS):** High-resolution SAR inundation polygons ($A_{\text{inundated}}$).
* **NASA Global Flood Monitoring (GFM):** Satellite-derived surface water depth estimates ($h_{\text{water}}$).
* **UN OCHA / HDX Population Grids:** Settlement population density layers ($\rho_{\text{local}}$).

### 2.2 Canonical Input Variable Definitions

| Symbol | Parameter Description | Source Field / API | Canonical Unit | Domain / Bounds |
| ----- | ----- | ----- | ----- | ----- |
| $h_{\text{water}}$ | Flood Water Inundation Depth | NASA GFM / Sentinel-1 SAR | $\text{m}$ | $[0.0, 30.0]$ |
| $A_{\text{inundated}}$ | Submerged Surface Area | Copernicus EMS / GDACS | $\text{km}^2$ | $[0.0, \infty)$ |
| $v_{\text{flow}}$ | Flood Water Current Velocity | Hydrodynamic Stream Gauge | $\text{m/s}$ | $[0.0, 15.0]$ |
| $\Delta t$ | Submersion Duration | Stream Gauge Telemetry | Hours | $[0.0, \infty)$ |
| $W_{\text{qual}}$ | Water Contamination Index ($0 = \text{clean runoff}, 1 = \text{sewage/industrial}$) | Environmental Agency / Field Sensor | Scalar | $[0.0, 1.0]$ |
| $\rho_{\text{local}}$ | Local Population Density | UN OCHA / HDX Grid | $\text{persons / km}^2$ | $[0.0, \infty)$ |
| $C_{\text{coping}}$ | Local NGO Coping Capacity Index | INFORM Risk Index | Scalar | $[0.1, 1.0]$ |

## 3. Core Mathematical Formulations

### 3.1 Population Displacement Fraction ($F_{\text{disp}}$)

Not all population within a flooded polygon is displaced. Displacement probability scales non-linearly with water depth $h_{\text{water}}$ and flow velocity $v_{\text{flow}}$:

$$
F_{\text{disp}}(h_{\text{water}}, v_{\text{flow}}) = \frac{1}{1 + e^{-2.5 \cdot (h_{\text{water}} - 0.5) + 0.8 \cdot v_{\text{flow}}}}
$$

*Constraint:* $0.0 \le F_{\text{disp}} \le 1.0$.

### 3.2 Affected Population Exposure ($P_{\text{aff}}$)

Total affected population $P_{\text{aff}}$ across flooded administrative zone $N$ is calculated by integrating spatial density against area and the displacement fraction:

$$
P_{\text{aff}} = \sum_{j \in N} \Big( A_{\text{inundated}, j} \cdot \rho_{\text{local}, j} \cdot F_{\text{disp}, j} \Big)
$$

### 3.3 Waterborne Disease Risk Index ($R_{\text{disease}}$)

Secondary waterborne disease outbreak risk (e.g., cholera, dysentery) is a function of submersion duration $\Delta t$ and contamination index $W_{\text{qual}}$:

$$
R_{\text{disease}}(\Delta t, W_{\text{qual}}) = \min\left(1.0, \, \left(1 - e^{-0.02 \cdot \Delta t}\right) \cdot (0.3 + 0.7 \cdot W_{\text{qual}})\right)
$$

### 3.4 Sphere Standard WASH & Humanitarian Shortfall Calculations

Resource requirements vector $\vec{D}$ for hydrological emergencies is defined according to **Sphere Project Minimum Standards** for Water, Sanitation, and Hygiene:

$$
\vec{D} = \begin{bmatrix} D_{\text{water}} \\ D_{\text{hygiene}} \\ D_{\text{shelter}} \\ D_{\text{cholera\_kits}} \end{bmatrix} = \begin{bmatrix} P_{\text{aff}} \cdot \left(15.0 + 10.0 \cdot W_{\text{qual}}\right) & [\text{Liters / Day}] \\ \left\lceil \frac{P_{\text{aff}}}{5.0} \right\rceil \cdot \left(1 + \lfloor W_{\text{qual}} \rceil\right) & [\text{Family Hygiene Kits}] \\ \left\lceil \frac{P_{\text{aff}}}{5.0} \right\rceil & [\text{Emergency Shelter Kits}] \\ \text{if } R_{\text{disease}} \ge 0.45 \text{ then } \left\lceil P_{\text{aff}} \cdot 0.015 \right\rceil \text{ else } 0 & [\text{Cholera Treatment Kits}] \end{bmatrix}
$$

Net Resource Shortfall Vector $\vec{R}$ is calculated against local inventory stocks $\vec{I}$:

$$
\vec{R} = \max\left(\vec{0}, \vec{D} - \sum_{k \in \text{Depots}} \vec{I}_k\right)
$$

## 4. Deterministic SOP State Machine & Trigger Gates

```
                 [ Ingest Flood Inundation & Hydro Data ]
                                    │
                                    ▼
                 Compute F_disp, P_aff, R_disease & Shortfalls
                                    │
           ┌────────────────────────┼────────────────────────┐
           ▼                        ▼                        ▼
     h_water < 0.3m        0.3m ≤ h_water < 1.0m       h_water ≥ 1.0m
   (LEVEL 0: NOMINAL)      (LEVEL 1: ADVISORY)      (LEVEL 2 or 3: ALERT)
           │                        │                        │
           ▼                        ▼                        ▼
    Log Telemetry &        Instantiate Workspace     Evaluate P_aff Gate
    Suppress Alerts        Poll Regional WASH        ┌───────┴───────┐
                                                     ▼               ▼
                                              P_aff < 15,000   P_aff ≥ 15,000
                                                 (LEVEL 2)       (LEVEL 3)
```

### 4.1 SOP Operational State Table

| State Level | Trigger Threshold | Automated Engine Workflow | Governance Output |
| ----- | ----- | ----- | ----- |
| **LEVEL 0: NOMINAL** | $h_{\text{water}} < 0.3\text{m}$ | Suppress workspace creation; log telemetry payload hash into audit buffer. | Audit Log Entry |
| **LEVEL 1: ADVISORY** | $0.3\text{m} \le h_{\text{water}} < 1.0\text{m}$ | Instantiate `HYDROLOGICAL_INCIDENT_WORKSPACE`; poll local water treatment inventory depots. | Card: `CARD_FLOOD_WATCH` |
| **LEVEL 2: CRITICAL INUNDATION** | $h_{\text{water}} \ge 1.0\text{m} \text{ OR } v_{\text{flow}} \ge 2.0\text{m/s}$ | Lock regional water/shelter inventory; dispatch high-water rescue and WASH units; calculate $\vec{R}$. | Card: `CARD_DISPATCH_WASH` |
| **LEVEL 3: CATASTROPHIC FLOOD** | $P_{\text{aff}} \ge 15,000 \text{ AND } W_{\text{qual}} \ge 0.7$ | Trigger cross-border international aid allocation; emit cryptographically signed OAG emergency appeal ledger item. | Workflow: `WORKFLOW_OAG_FLOOD_ALERT` |

## 5. Formal Mathematical Proof of Determinism

**Theorem:** *Given an identical hydrological event payload* $E$ *and state snapshot* $S$*, the Aegis Formulation Function* $f_{\text{hydro}}(E, S)$ *produces an invariant output state tuple* $(F_{\text{disp}}, P_{\text{aff}}, R_{\text{disease}}, \vec{R}, \text{StateLevel})$ *across all execution environments.*

**Proof:**

1. Let $E = \{ h_{\text{water}}, A_{\text{inundated}}, v_{\text{flow}}, \Delta t, W_{\text{qual}}, \rho_{\text{local}} \}$ be the canonical JSON representation of the flood event payload, normalized via `src/engine/canonical.ts`.

2. The sigmoid displacement function $F_{\text{disp}}$ and exponential disease risk function $R_{\text{disease}}$ rely strictly on deterministic arithmetic over IEEE 754 double-precision floating-point standard.

3. The vector calculations for $\vec{D}$ and net shortfall $\vec{R}$ contain no stochastic variables, random seeds, or external model calls.

4. State transition evaluation against fixed threshold constants ($0.3\text{m}, 1.0\text{m}, 15,000\text{ persons}$) yields a unique mapping $E \to \text{StateLevel}$.

5. Therefore, $f_{\text{hydro}}(E, S)$ is purely deterministic and zero-token invariant. $\blacksquare$

## 6. Implementation Checklist

* [x] Document mathematical specification in `AEG-FRM-002`.
* [ ] Implement formulation calculations in `src/registry/formulations/hydrological.ts`.
* [ ] Add unit tests verifying displacement fractions and WASH shortfall outputs against Copernicus historical flood data.
* [ ] Wire SOP state transition rules to `src/services/workflowEngine.ts`.