---
name: sem-market-data
description: "Retrieve wholesale electricity market results (day-ahead and intraday prices) from the official SEMOpx platform."
triggers:
  - "get SEM market data"
  - "SEM electricity prices"
  - "SEMOpx market results"
  - "Irish wholesale electricity prices"
  - "SEM day-ahead prices"
  - "download SEM market data"
parameters:
  - name: start_date
    required: true
    default: null
    description: "Start date for the market data query (format: DD/MM/YYYY as used by SEMOpx date picker)"
  - name: end_date
    required: false
    default: "same as start_date"
    description: "End date for the market data query. If omitted, retrieves a single day."
  - name: market_type
    required: false
    default: "Market Results"
    description: "Which market data page to query. Options include Market Results (DAM/IDA prices), Imbalance Pricing, etc."
---

# Skill: SEM Market Data Retrieval

## Purpose

Retrieve wholesale electricity market results from SEMOpx, the official platform for the Single Electricity Market (Ireland and Northern Ireland).

## When to Use

- User needs SEM day-ahead or intraday auction prices for a specific date range
- User needs Irish/Northern Irish wholesale electricity price data
- User wants to download market results from SEMOpx
- Building datasets for electricity market analysis covering the SEM region

## Parameters

| Parameter | Description | Required | Default |
|---|---|---|---|
| start_date | Start date for query (DD/MM/YYYY) | Yes | — |
| end_date | End date for query (DD/MM/YYYY) | No | Same as start_date |
| market_type | Which data page to use | No | Market Results |

## Procedure

### Step 1: Navigate to SEMOpx Market Results

**Purpose:** Reach the correct data page on the official source.
**Requires:** Nothing.
**Produces:** The market results page loaded and ready for filtering.

Navigate to `https://www.semopx.com/market-data/market-results`. This is the canonical and only official source for SEM market auction results. Do not use aggregators or third-party mirrors.

### Step 2: Set the Date Filter

**Purpose:** Filter the displayed results to the target date range.
**Requires:** `start_date` (and optionally `end_date`).
**Produces:** Market results filtered to the requested period.

Set the `StartTime` date input field to `{start_date}`. If `{end_date}` is provided and the page has an end date field, set that as well. Confirm or apply the filter if required.

### Step 3: Switch to Table View

**Purpose:** Display results in structured tabular format suitable for reading and export.
**Requires:** Filtered results from Step 2.
**Produces:** Data displayed as a table (columns typically include trading period, DAM price, IDA1/IDA2/IDA3 prices, and volumes).

Click the "Table" tab on the results page. The page defaults to a chart view; the table view is needed for data extraction and export.

### Step 4: Export the Data

**Purpose:** Download the market data as a file for analysis.
**Requires:** Table view active with filtered data from Step 3.
**Produces:** A downloaded file (typically CSV or Excel) containing the market results.

Click the download/export link on the table view. On SEMOpx this is typically rendered as an anchor element that triggers a JavaScript download action. The exported file will contain the filtered market results in a tabular format.

## Dependencies and Execution Order

All steps are strictly sequential:

```
Step 1 → Step 2 → Step 3 → Step 4
```

No parallelisation is possible — each step depends on the page state produced by the previous step.

## Expected Outputs

- A downloaded file (CSV or similar) containing SEM market results for the requested date range
- Columns typically include: trading period/timestamp, DAM price (€/MWh), IDA1/IDA2/IDA3 prices, and traded volumes
- Data covers both the Republic of Ireland and Northern Ireland (single market zone)

## Error Handling

| Issue | Resolution |
|---|---|
| Date picker format rejected | Use DD/MM/YYYY format; SEMOpx uses European date formatting |
| No data returned for date range | Check that the date range falls within available history; SEMOpx data begins from the I-SEM go-live (October 2018) |
| Export link not visible | Ensure the Table tab is active — the export option may only appear in table view |
| Page structure has changed | SEMOpx occasionally updates its interface; fall back to inspecting the page for alternative export mechanisms or check for an API endpoint in network requests |

## Notes

- SEMOpx is the sole official source for SEM auction results. The data is not paywalled.
- The SEM covers the all-island (Ireland + Northern Ireland) wholesale electricity market.
- Market results include Day-Ahead Market (DAM) and Intraday Auction (IDA) outcomes.
- For longer time series or programmatic access, consider checking whether SEMOpx exposes an API — the download action may trigger a fetch to a data endpoint that could be called directly.
- Related data sources: EirGrid (for system data, wind generation), SEMO (for balancing market/imbalance prices — a separate section of the same platform).
