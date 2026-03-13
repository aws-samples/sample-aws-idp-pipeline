// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';
import { stripMdLinksIntegration } from './remark-strip-md-links.mjs';
import { readFileSync } from 'node:fs';

const rootPkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
);

// https://astro.build/config
export default defineConfig({
  site: 'https://aws-samples.github.io',
  base: '/sample-aws-idp-pipeline',
  integrations: [
    mermaid(),
    starlight({
      title: 'AWS IDP Pipeline',
      components: {
        SiteTitle: './src/components/SiteTitle.astro',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/aws-samples/sample-aws-idp-pipeline',
        },
      ],
      defaultLocale: 'en',
      locales: {
        en: {
          label: 'English',
        },
        ko: {
          label: '한국어',
        },
        ja: {
          label: '日本語',
        },
      },
      sidebar: [
        {
          label: 'Overview',
          translations: {
            ko: '개요',
            ja: '概要',
          },
          link: '/',
        },
        {
          label: 'Features',
          translations: {
            ko: '기능',
            ja: '機能',
          },
          link: '/features',
        },
        {
          label: 'Preprocessing',
          translations: {
            ko: '전처리',
            ja: '前処理',
          },
          items: [
            {
              label: 'Overview',
              translations: {
                ko: '개요',
                ja: '概要',
              },
              link: '/preprocessing',
            },
            {
              label: 'OCR',
              translations: {
                ko: 'OCR',
                ja: 'OCR',
              },
              link: '/ocr',
            },
          ],
        },
        {
          label: 'Analysis Pipeline',
          translations: {
            ko: '분석',
            ja: '分析',
          },
          link: '/analysis',
        },
        {
          label: 'Database',
          translations: {
            ko: '데이터베이스',
            ja: 'データベース',
          },
          items: [
            {
              label: 'Overview',
              translations: {
                ko: '개요',
                ja: '概要',
              },
              link: '/database',
            },
            {
              label: 'Vector Database',
              translations: {
                ko: '벡터 데이터베이스',
                ja: 'ベクトルデータベース',
              },
              link: '/vectordb',
            },
            {
              label: 'Graph Database',
              translations: {
                ko: '그래프 데이터베이스',
                ja: 'グラフデータベース',
              },
              link: '/graphdb',
            },
            {
              label: 'DynamoDB',
              translations: {
                ko: 'DynamoDB',
                ja: 'DynamoDB',
              },
              link: '/dynamodb',
            },
          ],
        },
        {
          label: 'Agent',
          translations: {
            ko: '에이전트',
            ja: 'エージェント',
          },
          items: [
            {
              label: 'Overview',
              translations: {
                ko: '개요',
                ja: '概要',
              },
              link: '/agent',
            },
            {
              label: 'IDP Agent',
              translations: {
                ko: 'IDP 에이전트',
                ja: 'IDPエージェント',
              },
              link: '/agent-idp',
            },
            {
              label: 'Voice Agent',
              translations: {
                ko: '음성 에이전트',
                ja: '音声エージェント',
              },
              link: '/agent-voice',
            },
            {
              label: 'Web Crawler Agent',
              translations: {
                ko: '웹 크롤러 에이전트',
                ja: 'Webクローラーエージェント',
              },
              link: '/agent-webcrawler',
            },
          ],
        },
        {
          label: 'Deployment',
          translations: {
            ko: '배포',
            ja: 'デプロイ',
          },
          items: [
            {
              label: 'Guide',
              translations: {
                ko: '가이드',
                ja: 'ガイド',
              },
              link: '/deployment',
            },
            {
              label: 'Required Permissions',
              translations: {
                ko: '필요 권한',
                ja: '必要な権限',
              },
              link: '/permissions',
            },
          ],
        },
        {
          label: 'FAQ',
          translations: {
            ko: 'FAQ',
            ja: 'FAQ',
          },
          link: '/faq',
        },
        {
          label: 'License',
          translations: {
            ko: '라이센스',
            ja: 'ライセンス',
          },
          link: '/license',
        },
      ],
    }),
    stripMdLinksIntegration(),
  ],
  vite: {
    ssr: {
      noExternal: ['nanoid'],
    },
  },
});
