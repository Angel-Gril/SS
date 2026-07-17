# Sanitized PDD Network Fixtures

This directory is an executable Unit 0B contract corpus. Every fixture must validate against
`fixture.schema.json`, use a signature allowlisted by `contract.json`, and contain only the
bounded product fields needed for identity, title, image, SKU-option, and price evidence.

Prices use explicit integer CNY minor units (`price_fen`). Unknown prices are omitted or `null`;
zero and negative values are rejected rather than guessed. Cookies, authorization data, account
identifiers, and unrelated response branches are forbidden even when their values are redacted.
