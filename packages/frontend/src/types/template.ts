export type TemplateAnalysisStatus = 'analyzing' | 'completed' | 'failed';

export interface Template {
  template_id: string;
  name: string;
  description: string;
  file_type: string;
  thumbnail_url: string;
  created_at: string;
  analysis_status: TemplateAnalysisStatus;
  generated_prompt?: string;
}

// TODO: Replace with API data.
export const MOCK_TEMPLATES: Template[] = [
  {
    template_id: 'tpl-001',
    name: 'Business Proposal Deck',
    description: 'Clean 16:9 slides with title, agenda, and section dividers.',
    file_type: 'pptx',
    thumbnail_url:
      'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=800&q=80',
    created_at: '2026-06-20T09:00:00Z',
    analysis_status: 'completed',
    generated_prompt: `# Business Proposal Deck Template

## Overall Theme
- Clean, professional 16:9 layout with generous white space
- Primary color: deep navy (#1B2A4A); accent: warm amber (#F0A830)
- Typography: bold sans-serif headings, light body text

## Slide Structure
1. **Title slide** — centered title, subtitle, presenter name and date at bottom
2. **Agenda** — numbered list, max 5 items, left-aligned
3. **Section dividers** — full-bleed accent background with large section number
4. **Content slides** — two-column layout: key message left, supporting detail right
5. **Closing** — call to action with contact information

## Writing Style
- Headlines state conclusions, not topics (e.g. "Revenue grows 40%" not "Revenue")
- Body text limited to 3 bullet points per slide, each under 15 words
- Use data callouts in accent color for key figures`,
  },
  {
    template_id: 'tpl-002',
    name: 'Quarterly Report',
    description: 'Data-heavy layout with charts, tables, and summary sections.',
    file_type: 'pptx',
    thumbnail_url:
      'https://images.unsplash.com/photo-1543286386-713bdd548da4?w=800&q=80',
    created_at: '2026-06-18T14:30:00Z',
    analysis_status: 'analyzing',
  },
  {
    template_id: 'tpl-003',
    name: 'Product Overview',
    description: 'Slide layout with hero, features, and call to action.',
    file_type: 'pptx',
    thumbnail_url:
      'https://images.unsplash.com/photo-1517842645767-c639042777db?w=800&q=80',
    created_at: '2026-06-15T11:15:00Z',
    analysis_status: 'failed',
  },
  {
    template_id: 'tpl-004',
    name: 'Technical Design Deck',
    description: 'Structured slides for architecture, APIs, and diagrams.',
    file_type: 'pptx',
    thumbnail_url:
      'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800&q=80',
    created_at: '2026-06-10T08:45:00Z',
    analysis_status: 'completed',
    generated_prompt: `# Technical Design Deck Template

## Overall Theme
- Dark slate background (#0F172A) with light text, monospace accents for code
- Accent color: electric blue (#3B82F6) for diagrams and highlights

## Slide Structure
1. **Title slide** — system name, one-line summary, version and date
2. **Context** — problem statement and goals, single column
3. **Architecture** — full-width diagram slide with numbered component callouts
4. **API design** — left: endpoint table; right: request/response examples
5. **Trade-offs** — two-column comparison of considered alternatives

## Writing Style
- Prefer diagrams over text;每 slide has at most one diagram
- Use consistent component naming across all diagrams
- Code snippets in monospace blocks, max 10 lines`,
  },
  {
    template_id: 'tpl-005',
    name: 'Pitch Deck',
    description: 'Bold visual slides for storytelling and investor pitches.',
    file_type: 'pptx',
    thumbnail_url:
      'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&q=80',
    created_at: '2026-06-05T16:20:00Z',
    analysis_status: 'completed',
    generated_prompt: `# Pitch Deck Template

## Overall Theme
- Bold, high-contrast visuals with full-bleed photography
- One idea per slide; minimal text over imagery

## Slide Structure
1. **Hook** — single provocative statement over hero image
2. **Problem / Solution** — paired slides with mirrored layouts
3. **Market** — one big number per slide with source footnote
4. **Product** — screenshot-centered slides with one-line captions
5. **Team & Ask** — photo grid, closing slide with clear funding ask

## Writing Style
- Max 12 words per slide outside of appendix
- Numbers always paired with context (growth rate, comparison)
- Emotional narrative arc: tension → resolution → vision`,
  },
  {
    template_id: 'tpl-006',
    name: 'Team Update',
    description: 'Simple structured slides for agenda, status, and next steps.',
    file_type: 'pptx',
    thumbnail_url:
      'https://images.unsplash.com/photo-1497215728101-856f4ea42174?w=800&q=80',
    created_at: '2026-06-01T10:00:00Z',
    analysis_status: 'completed',
    generated_prompt: `# Team Update Template

## Overall Theme
- Minimal, functional layout on white background
- Status colors: green / amber / red chips for progress indicators

## Slide Structure
1. **Agenda** — plain numbered list
2. **Status board** — table with workstream, owner, status chip, one-line note
3. **Highlights** — max 3 wins with owner attribution
4. **Blockers** — each blocker paired with a requested action
5. **Next steps** — dated action items with owners

## Writing Style
- Telegraphic sentences; no filler words
- Every item names an owner and a date
- Keep the whole deck under 8 slides`,
  },
];
