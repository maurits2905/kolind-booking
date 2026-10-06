// Shown until config.js has a Supabase URL and publishable key.

import { html, mount } from '../html.js';
import { icon } from '../icons.js';

export default {
  async render(el) {
    mount(
      el,
      html`<div class="page setup-page">
        <div class="container container-narrow">
          <header class="page-head">
            <p class="eyebrow">Næsten klar</p>
            <h1 class="h1">Forbind siden til <em>Supabase</em></h1>
            <p class="lede">Siden kører, men mangler forbindelsen til databasen. Det tager omkring ti minutter, og det er gratis.</p>
          </header>
          <ol class="setup-steps">
            <li><strong>Opret et gratis projekt</strong> på supabase.com (intet betalingskort).</li>
            <li><strong>Kør databasen:</strong> åbn SQL Editor, indsæt hele <code>supabase/setup.sql</code>, og tryk Run.</li>
            <li><strong>Slå "Confirm email" fra</strong> under Authentication → Sign In / Providers → Email.</li>
            <li><strong>Kopiér Project URL og Publishable key</strong> (knappen Connect i Supabase) ind i <code>config.js</code>.</li>
            <li><strong>Lav de første invitationer</strong> med <code>supabase/first-admins.sql</code>, og åbn linkene.</li>
          </ol>
          <div class="notice">${icon('info')}<span>Hele vejledningen står i <strong>README.md</strong> i repositoriet.</span></div>
        </div>
      </div>`,
    );
  },
};
