/* Pet Hub Shop: ZIP-code shipping quote.
 * Uses the tokenless Shopify Storefront Cart API. It never modifies the shopper's cart.
 * No Admin API token, private credentials, or third-party shipping price assumptions.
 */
(() => {
  const API_PATH = '/api/2026-07/graphql.json';
  const MUTATION = [
    'mutation PetHubShippingQuote($input: CartInput) {',
    ' cartCreate(input: $input) {',
    '  userErrors { message }',
    '  cart {',
    '   deliveryGroups(first: 10) { nodes {',
    '    deliveryOptions { title deliveryMethodType estimatedCost { amount currencyCode } }',
    '   } }',
    '  }',
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
    }

    disconnectedCallback() {
      if (this._pending) this._pending.abort();
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
        const response = await fetch(API_PATH, {
          method: 'POST',
          credentials: 'omit',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: MUTATION, variables: { input } }),
          signal: controller.signal
        });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const body = await response.json();
        if (body.errors?.length || body.data?.cartCreate?.userErrors?.length) {
          throw new Error('Storefront API rejected shipping quote');
        }
        if (this._pending !== controller) return;
        const groups = body.data?.cartCreate?.cart?.deliveryGroups?.nodes || [];
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
