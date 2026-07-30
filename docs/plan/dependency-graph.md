# Dual-Mode Extension AI Image Workflow: Dependency Graph

```mermaid
flowchart TD
  subgraph P0[Phase 0 - Contract and baseline]
    subgraph P0A[Lane A - contracts]
      F1[FND-01 dual-mode contracts] --> F3[FND-03 limits and errors]
    end
    subgraph P0B[Lane B - regression]
      F2[FND-02 hosted/publish baseline]
    end
  end

  subgraph P1[Phase 1 - Dark security foundation]
    subgraph P1A[Lane A - server authorization]
      S1[SRV-01 policy/readiness] --> S2[SRV-02 ingest scope/grant]
      S1 --> R1[REL-01 admin controls]
    end
    subgraph P1B[Lane B - persistence]
      S3[SRV-03 provenance migration]
    end
    subgraph P1C[Lane C - extension trust boundary]
      E1[EXT-01 profile/session key]
      E2[EXT-02 optional permissions]
      E3[EXT-03 message policy]
    end
  end

  F1 --> S1
  F1 --> S3
  F1 --> E1
  F1 --> E2
  E1 --> E3

  subgraph P2[Phase 2 - Single-image BYOK vertical slice]
    subgraph P2A[Lane A - secure ingest]
      S4[SRV-04 normalize/store] --> S5[SRV-05 draft binding]
      S4 --> S6[SRV-06 billing guard]
    end
    subgraph P2B[Lane B - Provider]
      E4A[EXT-04A text-to-image] --> E5[EXT-05 capability evidence]
    end
    subgraph P2C[Lane C - minimal UX]
      U1[UI-01 Provider settings]
      U2A[UI-02A single-image workbench]
    end
    subgraph P2D[Lane D - integration]
      I1[INT-01 asset ingest client] --> I2[INT-02 publish bridge]
      I2 --> Q1[QA-01 vertical acceptance]
    end
  end

  F3 --> S4
  S1 --> S4
  S2 --> S4
  S3 --> S4
  S6 --> Q1
  E1 --> E4A
  E2 --> E4A
  S1 --> E4A
  E3 --> I1
  S5 --> I1
  E4A --> U2A
  E5 --> U1
  U2A --> I1
  F2 --> I2

  subgraph P3[Phase 3 - Edits and batch engine]
    subgraph P3A[Lane A - edit Provider adapters]
      E4B[EXT-04B edits/inpaint]
    end
    subgraph P3B[Lane B - planning/state]
      E7[EXT-07 Prompt/slot planner]
      E6[EXT-06 media job engine]
    end
    subgraph P3C[Lane C - editor]
      U3[UI-03 edit/inpaint UX]
    end
    Q2[QA-02 exact Provider sandbox]
  end

  Q1 --> E4B
  E5 --> E4B
  E4B --> E6
  Q1 --> E7
  E4B --> U3
  E6 --> U3
  U3 --> Q2

  subgraph P4[Phase 4 - Complete dual-mode workbench]
    subgraph P4A[Lane A - workspace]
      U4[UI-04 two-pane workbench] --> U5[UI-05 tasks/review/order]
    end
    subgraph P4B[Lane B - hosted]
      H1[HOST-01 hosted adapter]
    end
    subgraph P4C[Lane C - BYOK]
      B1[BYOK-01 batch coordinator]
    end
    U6[UI-06 source launch/context]
  end

  E6 --> U4
  E7 --> U4
  U3 --> U4
  F2 --> H1
  S6 --> H1
  U4 --> H1
  I1 --> B1
  E6 --> B1
  U4 --> B1
  H1 --> U6
  B1 --> U6
  U5 --> U6

  subgraph P5[Phase 5 - Publish and quality]
    I3[INT-03 unified publish semantics]
    Q3[QA-03 accessibility/responsive]
    Q4[QA-04 full security/regression]
    D1[DOC-01 user/admin documentation]
  end

  H1 --> I3
  B1 --> I3
  I2 --> I3
  U6 --> Q3
  I3 --> Q3
  Q2 --> Q4
  I3 --> Q4
  U6 --> D1
  I3 --> D1

  subgraph P6[Phase 6 - Pilot and release]
    R3[REL-03 extension packages] --> R4[REL-04 dark VPS deploy/pre-enable canary]
    R4 --> R2[REL-02 owner/shop/device pilot/post-enable canary]
  end

  Q3 --> R3
  Q4 --> R3
  D1 --> R3
```

## Critical Path

```text
FND-01
-> SRV-01/SRV-02/SRV-03
-> SRV-04
-> SRV-05
-> INT-01
-> INT-02
-> QA-01
-> EXT-04B/EXT-06
-> UI-04
-> HOST-01 and BYOK-01
-> INT-03
-> QA-04
-> REL-03/REL-04/REL-02
```

## Merge Ownership Hotspots

The following surfaces are serialized even when surrounding lanes run in parallel:

| Hotspot | Required ownership |
| --- | --- |
| `apps/server/prisma/schema.prisma` and migration order | One server-data owner |
| Extension device scopes and command-grant operations | One authorization owner |
| `apps/server/src/config/system-config-schema.ts` and admin settings | One configuration owner |
| `apps/server/src/index.ts` route registration | One integration owner |
| `extensions/ss-erp/background/service-worker.js` | Thin-dispatch owner only |
| `runtime-message-policy.js` | One message-security owner |
| Manifest, package builder, and package verifier | One extension-release owner |
| Existing source workbench/costing panel | Launcher-only owner |

New Provider, profile, job-engine, ingest, provenance, coordinator, and standalone workbench
logic stays in focused modules so parallel lanes do not grow existing monoliths.
