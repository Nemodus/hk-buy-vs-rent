# Buy or Rent — Hong Kong

A single-page model comparing two ways to live in the same Hong Kong flat: taking a mortgage and buying it,
or renting it and putting the same money into the markets.

The comparison is held honest by forcing the cash flows to match. Every dollar the owner spends in a month —
mortgage, rates, management fee, insurance, repairs — the renter spends on rent and invests whatever is left
over. Neither side is allowed to be cheaper month to month, so the only question left is what each one is
worth at the end.

## What's here

```
index.html                       the whole tool, one self-contained file
data/market.json                 RVD market statistics, refreshed monthly
scripts/fetch-rvd.mjs            pulls the RVD CSVs and flattens them to JSON
scripts/build.mjs                embeds that JSON into index.html
.github/workflows/refresh-data.yml   runs both on the 3rd of each month
```

## Running it

Open `index.html`. There is no build step for using it and no server required — the market data is embedded
in the page.

To refresh the data by hand:

```bash
node scripts/fetch-rvd.mjs    # writes data/market.json
node scripts/build.mjs        # embeds it in index.html
```

`node scripts/fetch-rvd.mjs --check` fetches and reports without writing anything.

## Why the data is baked in rather than fetched

`rvd.gov.hk` serves its CSVs without an `Access-Control-Allow-Origin` header, so a page on any other origin
cannot read them from the browser. Roughly half the URLs in the data.gov.hk catalogue are also plain `http`,
which a page served over `https` refuses to load.

Fetching at build time sidesteps both, and is better anyway:

- the page works offline and from a `file://` URL
- it loads one 60 kB file instead of a dozen CSV round-trips
- there is no runtime dependency on a government server being reachable
- **the git history becomes an audit trail.** RVD marks recent periods `P` for provisional and restates them
  later; the commit log shows exactly which figures moved and when.

Served over `http(s)` the page additionally tries `data/market.json` and upgrades itself if that copy is
newer, so a data refresh shows up without rebuilding the HTML.

## Data

All market data is from the [Rating and Valuation
Department](https://data.gov.hk/en-data/dataset/hk-rvd-tsinfo_rvd-property-market-statistics) via
data.gov.hk, used under the [terms and conditions](https://data.gov.hk/en/terms-and-conditions) of that site.

| Series | Coverage |
| --- | --- |
| Price index by class | quarterly from 1979 Q4, monthly from 1993 |
| Rental index by class | quarterly from 1979 Q4, monthly from 1993 |
| Gross yields by class | monthly from 1999 |

Classes are by saleable area: A under 40 m², B 40–70, C 70–100, D 100–160, E 160 m² and over. Classes D and E
are only reported separately from 1993; before that they appear only as a combined D&E figure.

Two things to keep in mind when reading any of it: **an index is not your flat** — these are quality-adjusted
territory-wide averages and a specific building can diverge a long way — and **recent periods are
provisional**.

## Caveats on the model

It is deterministic unless you run the simulation, assumes you stay put for the whole horizon in both
scenarios, and ignores everything that does not reduce to cash: security of tenure, the freedom to renovate,
the risk of a forced sale into a weak market, and the discipline to actually invest the surplus every month
rather than spend it.

Mortgage insurance is not charged, so a loan-to-value above 70% flatters the buying side by roughly the
1.5–5% of the loan an HKMC premium would cost.

A model, not advice.
