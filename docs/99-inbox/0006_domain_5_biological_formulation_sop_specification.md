# AEG-FRM-005: Domain 5 — Epidemic & Public Health Outbreaks (Biological & Vector-Borne Threats) Formulation & SOP Specification

**Document Reference:** AEG-FRM-005

**Classification:** Formulation & SOP Specification / Open Autonomous Governance (OAG)

**Status:** Approved

**Author:** Systems Architect / CTO Office

**Target Engine:** Aegis NGO Deterministic Formulation Engine (`src/registry/formulations/biological.ts`)

## 1. Executive Summary

Domain 5 governs public health emergencies, biological outbreaks, and vector-borne crises (e.g., cholera, dengue, and acute viral transmissions) that frequently occur as secondary disasters in displaced populations or catastrophe zones. Unlike physical environmental hazards (earthquakes, floods, cyclones, and wildfires), biological threats operate on **exponential demographic transmission vectors**.

This specification establishes the exact deterministic epidemiological equations, data normalization rules from **WHO Disease Outbreak News (DON)** and **US CDC / ECDC feeds**, Sphere Project health standards, and deterministic Standard Operating Procedure (SOP) state gates executed by the Aegis NGO engine.

## 2. Normalized Data Variable Register

All incoming variables are ingested from zero-cost open public feeds, parsed, and mapped into canonical Aegis data structures before evaluation.

| Symbol | Parameter Description | Source Feed | Canonical Unit | 
| ----- | ----- | ----- | ----- | 
| $I_0$ | Active Confirmed Cases (Index Count) | WHO DON / Ministry of Health Feed | Count | 
| $R_0$ | Basic Reproduction Number | Epidemiological Standard / WHO | Scalar ($0.8 \text{ to } 15.0$) | 
| $\gamma$ | Recovery Rate ($\frac{1}{\text{Infectious Duration in Days}}$) | Pathogen Parameter | Days$^{-1}$ | 
| $P_0$ | Total Population at Risk in Catchment Area | UN OCHA / HDX Grid | Count | 
| $H_{\text{beds}}$ | Available Isolation / Acute Care Beds | WHO Service Availability (SARA) | Count | 
| $S_{\text{clean}}$ | Clean Water Access Coverage Percentage | Sphere WASH Index ($0.0 \text{ to } 1.0$) | Percentage | 

## 3. Core Mathematical Formulations

### 3.1 Effective Reproduction Rate ($R_e$) & Sanitation Scaling

The effective reproduction rate accounts for local WASH infrastructure and coping density. High clean water access ($S_{\text{clean}}$) dampens transmission for enteric pathogens (e.g., cholera):

$$
R_e = R_0 \cdot (1.0 - 0.4 \cdot S_{\text{clean}})
$$

### 3.2 Short-Term Projected Infection Count ($I(t)$)

Using an early-stage exponential growth model (SIR early-phase approximation for $t = 14$ days):

$$
I(t) = I_0 \cdot e^{(R_e \cdot \gamma - \gamma) \cdot t} \quad [\text{Projected Active Cases at } t \text{ days}]
$$

*Constraint:* If $I(t) > P_0$, $I(t) = P_0$.

### 3.3 Medical Capacity Deficit ($\Delta H$)

The bed/treatment capacity shortfall relative to local isolation capability:

$$
\Delta H = \max\left(0, \, \lceil I(t) \cdot \alpha_{\text{severe}} \rceil - H_{\text{beds}}\right)
$$

*(where $\alpha_{\text{severe}}$ is the disease-specific severe hospitalization fraction, e.g., $0.15$ for severe cases).*

### 3.4 Sphere Standard Medical & WASH Shortfalls ($\Delta R$)

1. **Oral Rehydration Therapy (ORT) / IV Fluid Kits:**
   

   $$
   \Delta R_{\text{fluids}} = \left\lceil I(t) \cdot 3.0 \right\rceil \quad [\text{Liters / Patient / Day}]
   $$

2. **Personal Protective Equipment (PPE) Sets (Healthcare Workers):**
   

   $$
   \Delta R_{\text{ppe}} = \left\lceil I(t) \cdot 10.0 \cdot 14 \right\rceil \quad [\text{PPE Sets for 14-day operational cycle}]
   $$

3. **Clean Water Supply Upgrade ($\Delta R_{\text{water}}$):**
   

   $$
   \Delta R_{\text{water}} = P_0 \cdot (20.0 - 15.0 \cdot S_{\text{clean}}) \quad [\text{Liters / Person / Day}]
   $$

4. **Water Chlorination & Diagnostic Assay Kits:**
   

   $$
   \Delta R_{\text{diagnostics}} = \left\lceil I(t) \cdot 2.5 \right\rceil \quad [\text{Rapid Diagnostic Test Kits}]
   $$

## 4. Deterministic SOP State Machine & Threshold Gates

The engine evaluates state transitions without LLM intervention based on computed $R_e$, $I_0$, and projected bed deficits:

```
                  [ Ingest WHO / CDC Outbreak Event ]
                               │
                               ▼
                Calculate Re, I(t) & Capacity Delta
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
     Re ≤ 1.0 & I0 < 50   Re > 1.0 & I0 < 250   I(14) ≥ H_beds
       (LEVEL 0)         (LEVEL 1)         (LEVEL 2/3)
            │                  │                  │
            ▼                  ▼                  ▼
     EPIDEMIC WATCH     OUTBREAK ALERT       LOCAL EPIDEMIC
```

### SOP Action Matrix

| State Level | Trigger Condition | Deterministic Engine Action | Automated Governance Output | 
| ----- | ----- | ----- | ----- | 
| **LEVEL 0: EPIDEMIC WATCH** | $R_e \le 1.0 \text{ AND } I_0 < 50$ | Log pathogen telemetry; suppress active emergency alerts. | Internal audit log entry only. | 
| **LEVEL 1: OUTBREAK ALERT** | $R_e > 1.0 \text{ AND } 50 \le I_0 < 250$ | Instantiate epidemiological tracking card; verify regional PPE and ORS buffer stocks. | Open `CARD_EPIDEMIC_WATCH` | 
| **LEVEL 2: LOCAL EPIDEMIC** | $I(14) \ge H_{\text{beds}} \text{ OR } I_0 \ge 250$ | Dispatch mobile isolation units and IV fluid stockpiles; compute 14-day $\Delta R$ shortfalls. | Open `CARD_DISPATCH_HEALTH` | 
| **LEVEL 3: CATASTROPHIC HEALTH EMERGENCY** | $I(14) \ge 10,000 \text{ OR } \Delta H \ge 500$ | Trigger international WHO/UN OAG emergency appeal; lock regional distribution hubs. | Execute `WORKFLOW_OAG_HEALTH_ALERT` | 

## 5. Formal Mathematical Proof of Determinism

**Theorem:** Given identical WHO/CDC outbreak inputs $(I_0, R_0, \gamma, P_0, H_{\text{beds}}, S_{\text{clean}})$, the Aegis formulation engine shall produce bit-identical output vectors $(\Delta R_{\text{fluids}}, \Delta R_{\text{ppe}}, \Delta R_{\text{water}}, \text{SOP State})$ across all compute nodes.

**Proof:**

1. All epidemiological calculations ($R_e$, exponential growth $I(t)$, bed deficit $\Delta H$) depend entirely on deterministic arithmetic, exponential equations, and ceiling functions conforming to IEEE 754 floating-point standards.

2. No stochastic elements, random Monte Carlo iterations, or unseeded variables exist within `src/registry/formulations/biological.ts`.

3. LLM reasoning layers are strictly isolated from mathematical triage calculations; text generation occurs only downstream during human-in-the-loop report formatting.

4. Therefore, $\forall x \in \text{Inputs}, \, f(x) \equiv f(x)$ across all distributed worker nodes, preserving cryptographic audit chain integrity. Q.E.D.