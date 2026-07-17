# Source Marketplace Network Evidence Contract

Status: **synthetic contract characterization implemented; Unit 0B marketplace acceptance and Unit 3 remain pending**

PDD and Taobao/Tmall network evidence must be captured by a document-start MAIN-world observer using an explicit allowlist. Fixtures must be sanitized before entering the repository: remove cookies, authorization headers, account identifiers and unrelated response bodies.

The repository currently contains six synthetic, secret-free fixtures under `scripts/fixtures/source-collect/{pdd,taobao}`. `scripts/source-marketplace-contract.test.mjs` validates their Draft-07 schemas, response-signature allowlists, identity binding, SKU uniqueness/options, platform-specific price units, recursive secret scanning and explicit reject decisions.

Each accepted candidate must include:

- platform and product identity;
- response signature and observed timestamp;
- SKU rows with positive prices and stable option labels;
- title and main-image evidence;
- field-level source paths and confidence;
- explicit rejection reason when identity or price validation fails.

Unknown freight remains `null`; explicit free shipping is `0` with `free=true`. A passive-capture miss must leave the existing DOM/state collector operational and record the degradation. CDP distribution is still a measured-decision item, not a frozen policy: real-page miss rates and browser canaries are required before choosing Web Store versus controlled enterprise distribution.
