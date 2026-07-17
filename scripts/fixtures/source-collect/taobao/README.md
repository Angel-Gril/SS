# Sanitized Taobao/Tmall Network Fixtures

This directory is an executable Unit 0B contract corpus. Every fixture must validate against
`fixture.schema.json`, use a signature allowlisted by `contract.json`, and contain only the
bounded item and SKU branches needed by the collector.

Prices use explicit decimal CNY strings (`priceText`). They are never interpreted through a
global integer heuristic. Cookies, authorization data, account identifiers, and unrelated
response branches are forbidden even when their values are redacted.
