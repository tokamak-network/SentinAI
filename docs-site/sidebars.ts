import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    {
      type: 'category',
      label: 'Get Started',
      collapsed: false,
      items: [
        'guide/overview',
        'guide/quickstart',
        'guide/troubleshooting',
      ],
    },
    {
      type: 'category',
      label: 'Deploy',
      collapsed: false,
      items: [
        'guide/setup',
        'guide/ec2-setup-guide',
        'guide/opstack-example-runbook',
        'guide/arbitrum-orbit-local-setup',
      ],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: false,
      items: [
        'guide/architecture',
        'guide/api-reference',
        'guide/sentinai-mcp-user-guide',
      ],
    },
  ],
};

export default sidebars;
