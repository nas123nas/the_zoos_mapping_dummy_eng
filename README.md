# THE ZOOS · Order Mapping and Inventory Demo

[Open the English demo](https://nas123nas.github.io/the_zoos_mapping_dummy_eng/)

This portfolio demo shows how an operations team can match incoming orders to a product catalog and manage inventory from one workspace. It includes 58 fictional pet products and sample orders, stock levels, suppliers, and inbound schedules.

## Explore the demo

- **Dashboard** — Search the entire catalog by product name or barcode, open product details, and filter the inventory or supplier coordination tables.
- **Order Mapping** — Run the preloaded sample order, review flagged items, and export mapping results from Activity History.
- **Inbound Planning** — Compare weekly or custom date ranges, review stockouts, and update supplier coordination records.
- **Inventory Tools** — Track customer-reserved stock and manage remaining quantities and expiry dates by lot.

Changes made in the demo are stored in the current browser.

## Run locally

Serve the repository root and open [localhost:8765](http://localhost:8765/).

```sh
python -m http.server 8765
```

## Run the checks

```sh
node --test tests/*.test.cjs
```

The included GitHub Actions workflow publishes the static site from the `main` branch using GitHub Pages.
