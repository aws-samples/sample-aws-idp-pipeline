// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { stripMdLinksIntegration } from './remark-strip-md-links.mjs';

// https://astro.build/config
export default defineConfig({
	site: 'https://aws-samples.github.io',
	base: '/sample-aws-idp-pipeline',
	integrations: [
		starlight({
			title: 'AWS IDP Pipeline',
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
					label: 'Analysis Pipeline',
					translations: {
						ko: 'AI 분석 파이프라인',
						ja: 'AI分析パイプライン',
					},
					link: '/analysis',
				},
				{
					label: 'Preprocessing',
					translations: {
						ko: '전처리 파이프라인',
						ja: '前処理パイプライン',
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
				{
					label: 'Vector Database',
					translations: {
						ko: '벡터 데이터베이스',
						ja: 'ベクトルデータベース',
					},
					link: '/vectordb',
				},
				{
					label: 'Deployment',
					translations: {
						ko: '배포 가이드',
						ja: 'デプロイガイド',
					},
					link: '/deployment',
				},
				{
					label: 'FAQ',
					translations: {
						ko: 'FAQ',
						ja: 'FAQ',
					},
					link: '/faq',
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
