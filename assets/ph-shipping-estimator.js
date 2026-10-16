/* Pet Hub Shop: ZIP-code shipping quote.
 * Uses the tokenless Shopify Storefront Cart API. It never modifies the shopper's cart.
 * No Admin API token, private credentials, or third-party shipping price assumptions.
 */
(() => {
  const API_PATH = '/api/2026-07/graphql.json';
  const CREATE_MUTATION = [
    'mutation PetHubShippingCart($input: CartInput) {',
    ' cartCreate(input: $input) {',
    '  userErrors { message }',
    '  cart { id }',
    ' }',
    '}'
  ].join(' ');

  // The Collective Carrier Service is a carrier-calculated rate provider.
  // Shopify hides those rates unless withCarrierRates:true is requested in
  // an @defer fragment. Source: shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/defer
  const RATES_QUERY = [
    'query PetHubShippingRates($id: ID!) {',
    ' cart(id: $id) { id ... CollectiveRates @defer }',
    '}',
    'fragment CollectiveRates on Cart {',
    ' deliveryGroups(first: 10, withCarrierRates: true) {',
    '  nodes { deliveryOptions { title deliveryMethodType estimatedCost { amount currencyCode } } }',
    ' }',
    '}'
  ].join(' ');

  class PhShippingEstimator extends HTMLElement {
    connectedCallback() {
      if (this._initialized) return;
      this._initialized = true;
      this.quoteForm = this.querySelector('[data-ph-quote-form]');
      this.zipInput = this.querySelector('[data-ph-zip]');
      this.submitButton = this.querySelector('[data-ph-submit]');
      this.status = this.querySelector('[data-ph-status]');
      this.results = this.querySelector('[data-ph-results]');
      if (!this.quoteForm || !this.zipInput || !this.results) return;
      this.quoteForm.addEventListener('submit', (event) => {
        event.preventDefault();
        this.calculate();
      });

      // A previous estimate must not remain visible after the buyer changes
      // the active size/color. Horizon updates its variant ID asynchronously.
      this._productScope = this.closest('.product-details') || this.closest('section') || document;
      this._onVariantChange = (event) => {
        if (!event.target?.closest?.('variant-picker')) return;
        if (this._pending) {
          this._pending.abort();
          this._pending = null;
          this.submitButton.disabled = false;
        }
        this.results.replaceChildren();
        this.status.textContent = 'Product option changed. Check shipping again for the updated estimate.';
      };
      this._productScope.addEventListener('change', this._onVariantChange);
    }

    disconnectedCallback() {
      if (this._pending) this._pending.abort();
      this._productScope?.removeEventListener('change', this._onVariantChange);
    }

    currentVariantId() {
      // The product-details wrapper also contains Horizon's buy-buttons block.
      // Read its live hidden input at click time, not the initially rendered variant.
      const scope = this.closest('.product-details') || this.closest('section') || document;
      const input = scope.querySelector(
        'product-form-component form[data-type="add-to-cart-form"] input[name="id"]'
      );
      const raw = (input && input.value) || this.dataset.initialVariantId || '';
      return /^\d+$/.test(raw) ? raw : null;
    }

    showMessage(message) {
      this.status.textContent = message;
      this.results.replaceChildren();
    }

    renderOptions(groups) {
      this.results.replaceChildren();
      const usable = groups.map((g) => (g.deliveryOptions || [])
        .filter((opt) => opt.deliveryMethodType === 'SHIPPING'
          && opt.estimatedCost && Number.isFinite(Number(opt.estimatedCost.amount)))
        .sort((a, b) => Number(a.estimatedCost.amount) - Number(b.estimatedCost.amount))
      ).filter((options) => options.length);

      if (!usable.length) {
        this.showMessage('Shipping could not be estimated from this ZIP code. Please check your full address at checkout.');
        return;
      }

      this.status.textContent = 'Estimated shipping options:';
      usable.forEach((options, groupIndex) => {
        if (usable.length > 1) {
          const heading = document.createElement('p');
          heading.className = 'ph-shipping__group-label';
          heading.textContent = 'Shipment ' + (groupIndex + 1);
          this.results.appendChild(heading);
        }
        const list = document.createElement('ul');
        list.className = 'ph-shipping__rates';
        options.forEach((option) => {
          const item = document.createElement('li');
          const label = document.createElement('span');
          label.textContent = option.title || 'Shipping';
          const price = document.createElement('strong');
          const amount = Number(option.estimatedCost.amount);
          price.textContent = amount === 0
            ? 'Free'
            : new Intl.NumberFormat('en-US', {
                style: 'currency',
                currency: option.estimatedCost.currencyCode || 'USD'
              }).format(amount);
          item.append(label, price);
          list.appendChild(item);
        });
        this.results.appendChild(list);
      });

      const note = document.createElement('p');
      note.className = 'ph-shipping__note';
      note.textContent = 'Estimate for this item only. Final shipping and eligibility are confirmed at checkout using the complete address.';
      this.results.appendChild(note);
    }


    hasRates(groups) {
      return groups.some((g) => (g.deliveryOptions || []).some(
        (option) => option.deliveryMethodType === 'SHIPPING' && option.estimatedCost
      ));
    }

    async lookupZip(zip, signal) {
      try {
        const response = await fetch('https://api.zippopotam.us/us/' + zip, {
          method: 'GET',
          credentials: 'omit',
          signal
        });
        if (!response.ok) return null;
        const result = await response.json();
        const place = result.places?.[0];
        if (!place || !place['place name'] || !place['state abbreviation']) return null;
        return { city: place['place name'], state: place['state abbreviation'] };
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        return null;
      }
    }

    async quoteForDestination(input, signal) {
      const createdPackets = await this.queryStorefront(
        CREATE_MUTATION, { input }, signal
      );
      const created = createdPackets.find((p) => p.data?.cartCreate);
      if (!created || created.errors?.length ||
          created.data.cartCreate.userErrors?.length) {
        throw new Error('Could not create a temporary cart to estimate shipping');
      }
      const id = created.data.cartCreate.cart?.id;
      if (!id) throw new Error('Temporary cart ID missing');

      const packets = await this.queryStorefront(RATES_QUERY, { id }, signal);
      let groups = [];
      for (const packet of packets) {
        if (packet.errors?.length) throw new Error('Shipping rates query failed');
        if (packet.data?.cart?.deliveryGroups?.nodes) {
          groups = packet.data.cart.deliveryGroups.nodes;
        }
        for (const patch of (packet.incremental || [])) {
          if (patch.errors?.length) throw new Error('Deferred shipping rate calculation failed');
          const deferred = patch.data?.deliveryGroups?.nodes ||
            patch.data?.cart?.deliveryGroups?.nodes;
          if (deferred) groups = deferred;
        }
      }
      return groups;
    }

    async queryStorefront(query, variables, signal) {
      const response = await fetch(API_PATH, {
        method: 'POST',
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'multipart/mixed, application/json'
        },
        body: JSON.stringify({ query, variables }),
        signal
      });
      if (!response.ok) throw new Error('Storefront API HTTP ' + response.status);
      const content = await response.text();
      const type = response.headers.get('content-type') || '';
      if (!type.toLowerCase().includes('multipart/mixed')) {
        return [JSON.parse(content)];
      }
      const boundaryMatch = type.match(/boundary="?([^";\s]+)"?/i);
      if (!boundaryMatch) throw new Error('Missing GraphQL multipart boundary');
      const boundary = '--' + boundaryMatch[1];
      const packets = [];
      for (const part of content.split(boundary)) {
        const separator = /\r?\n\r?\n/.exec(part);
        if (!separator) continue;
        const json = part.slice(separator.index + separator[0].length).trim();
        if (json && json !== '--') packets.push(JSON.parse(json));
      }
      if (!packets.length) throw new Error('No GraphQL multipart response');
      return packets;
    }

    async calculate() {
      const zip = this.zipInput.value.trim();
      if (!/^\d{5}$/.test(zip)) {
        this.showMessage('Enter a valid 5-digit US ZIP code.');
        return;
      }

      const variantId = this.currentVariantId();
      if (!variantId) {
        this.showMessage('Please select a product option before checking shipping.');
        return;
      }

      if (this._pending) this._pending.abort();
      const controller = new AbortController();
      this._pending = controller;
      this.submitButton.disabled = true;
      this.results.replaceChildren();
      this.status.textContent = 'Checking live shipping options…';

      const input = {
        lines: [{ merchandiseId: 'gid://shopify/ProductVariant/' + variantId, quantity: 1 }],
        buyerIdentity: { countryCode: 'US' },
        delivery: { addresses: [{
          selected: true,
          oneTimeUse: true,
          validationStrategy: 'COUNTRY_CODE_ONLY',
          address: { deliveryAddress: { countryCode: 'US', zip: zip } }
        }] }
      };

      try {
        let groups = await this.quoteForDestination(input, controller.signal);

        // Some carriers require city + state, not just a ZIP. Attempt an
        // additional quote with a public ZIP-to-city lookup, never with a
        // fabricated street address.
        if (!this.hasRates(groups)) {
          const location = await this.lookupZip(zip, controller.signal);
          if (location) {
            input.delivery.addresses[0].address.deliveryAddress = {
              countryCode: 'US',
              zip,
              city: location.city,
              provinceCode: location.state
            };
            groups = await this.quoteForDestination(input, controller.signal);
          }
        }

        if (this._pending !== controller) return;
        this.renderOptions(groups);
      } catch (error) {
        if (error.name !== 'AbortError' && this._pending === controller) {
          this.showMessage('Shipping is temporarily unavailable here. You can still add the product to your cart and check rates at checkout.');
        }
      } finally {
        if (this._pending === controller) {
          this.submitButton.disabled = false;
          this._pending = null;
        }
      }
    }
  }

  if (!customElements.get('ph-shipping-estimator')) {
    customElements.define('ph-shipping-estimator', PhShippingEstimator);
  }
})();
