# Pet Hub Shop — optional ZIP code shipping estimator

## Status
This product-page widget uses the tokenless Shopify Storefront Cart API to request live delivery options for one selected product variant and a five-digit US ZIP code. It does not change the real buyer cart, set prices, or modify supplier shipping rates.

## Theme files
- assets/ph-shipping-estimator.js — Storefront GraphQL cartCreate quote and error handling.
- blocks/ph-shipping-estimator.liquid — accessible block for Horizon-based product pages.

## Installation in the Pet Hub theme
1. Duplicate the published theme; never edit MAIN to test.
2. Upload both files with their paths.
3. In templates/product.json, under sections.main.blocks.product-details.blocks, add ph_shipping_estimate with type ph-shipping-estimator and empty settings.
4. Insert ph_shipping_estimate immediately after buy_buttons_eYQEYi in block_order.
5. Preview the unpublished theme, select a variant, enter a ZIP and compare with checkout.
6. Remove ph_shipping_estimate from block_order and blocks to roll back; do not touch shipping profiles.

## Privacy and implementation
- Endpoint: /api/2026-07/graphql.json on the same store domain; Shopify supports tokenless Cart read/write.
- No Admin API token or private secret is stored in GitHub or the theme.
- The Collective Carrier Service requires Cart.deliveryGroups(withCarrierRates: true) in an @defer fragment; the widget performs cartCreate then cart query, parsing the multipart/mixed incremental payload.
- Creates a separate disposable Storefront API cart with country US and the selected 5-digit ZIP.
- The ZIP is sent to Shopify. Only if the initial quote has no shipping options, the widget sends the five-digit ZIP (without a name or street address) to public service Zippopotam.us to resolve city and state for a second attempt. No ZIP is sent to GitHub.
- Reads the currently selected variant from Horizon buy-buttons input[name=id] at click time.
- Displays carrier-calculated options; does not invent prices or create a weighted average.
- If ZIP is insufficient to calculate a rate, customers are directed to enter their full address at checkout.
- Rates are estimates for one variant and do not include multi-vendor combined cart charges.

## Pre-release test checklist
- US ZIP 90001 (Los Angeles), 10001 (New York), 75201 (Dallas), 33101 (Miami), 60601 (Chicago).
- At least cushion, Paperpark, KONG, wooden house, cat tree and an out-of-stock variant.
- Mobile and desktop; empty/non-US ZIP validation; chosen variant changes; Shopify checkout remains untouched.
- Compare with actual checkout. If mismatched, do not publish.
- Note: some carrier services may require city, state or street address; a ZIP-only quote is not guaranteed.

Shopify references:
https://shopify.dev/docs/api/storefront/2026-07/mutations/cartCreate
https://shopify.dev/docs/api/storefront/2026-07/objects/CartDeliveryGroup
https://shopify.dev/docs/api/storefront/2026-07/objects/CartDeliveryOption
## Troubleshooting / fix Oct 16, 2026
- Initial version used deliveryGroups without withCarrierRates, which omits carrier-calculated rates and caused ZIP 10001 to show no options.
- Patched to use an @defer fragment for calculated carrier rates and parse streamed multipart/mixed GraphQL responses.
- A mock multipart response test passed, but a real-browser cross-check remains required before publication.
- Zippopotam.us fallback runs only when the first Shopify request returns no rates. It sends only the ZIP Code; see https://api.zippopotam.us/.
