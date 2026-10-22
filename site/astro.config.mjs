// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://getabe.app',
  // Pages are emitted as `download.html` and served by Cloudflare Pages at
  // `/download`, so canonical URLs never carry a trailing slash.
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [
    sitemap(),
    starlight({
      title: 'Abe Docs',
      description: 'Documentation for Abe, the free and open-source voice-to-text app.',
      logo: { src: './src/assets/logo.png', alt: 'Abe' },
      favicon: '/favicon.ico',
      disable404Route: true,
      customCss: [
        '@fontsource-variable/inter',
        '@fontsource-variable/jetbrains-mono',
        './src/styles/starlight.css',
      ],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/HardHeadHackerHead/honest-abe' }],
      editLink: { baseUrl: 'https://github.com/HardHeadHackerHead/honest-abe/edit/main/site/' },
      components: {
        ThemeProvider: './src/components/starlight/ThemeProvider.astro',
        ThemeSelect: './src/components/starlight/ThemeSelect.astro',
        SocialIcons: './src/components/starlight/SocialIcons.astro',
      },
      head: [
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' } },
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://getabe.app/og.png' } },
        { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
        { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://getabe.app/og.png' } },
      ],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Introduction', link: '/docs' },
            { slug: 'docs/getting-started' },
            { slug: 'docs/choosing-an-engine' },
            { slug: 'docs/local-models' },
            {
              label: 'API keys',
              items: [
                { label: 'Overview', slug: 'docs/api-keys' },
                { slug: 'docs/api-keys/groq' },
                { slug: 'docs/api-keys/openai' },
                { slug: 'docs/api-keys/custom' },
              ],
            },
            { slug: 'docs/costs' },
          ],
        },
        {
          label: 'Using Abe',
          items: [
            { slug: 'docs/hotkeys' },
            { slug: 'docs/voice-transform' },
            { slug: 'docs/dictionary' },
            { slug: 'docs/audio-ducking' },
            { slug: 'docs/output-modes' },
            { slug: 'docs/history' },
            { slug: 'docs/settings' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { slug: 'docs/privacy-security' },
            { slug: 'docs/troubleshooting' },
            { slug: 'docs/faq' },
          ],
        },
        {
          label: 'Contribute',
          items: [{ slug: 'docs/building-from-source' }, { slug: 'docs/contributing' }],
        },
      ],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
