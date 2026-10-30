import { visualElement } from '@demoledger/shared';
import { defineCatalog } from '@json-render/core';
import { schema } from '@json-render/react/schema';

/**
 * The fixed json-render catalog for generative UI. Prop schemas come straight from the shared
 * `VisualSpec` contract, so a spec that validates against the contract always matches this catalog.
 * No actions: the renderer cannot trigger anything, and nothing here is evaluated.
 */
const byType = Object.fromEntries(visualElement.options.map((o) => [o.shape.type.value, o.shape.props])) as {
  BarChart: (typeof visualElement.options)[0]['shape']['props'];
  LineChart: (typeof visualElement.options)[1]['shape']['props'];
  Table: (typeof visualElement.options)[2]['shape']['props'];
  Stat: (typeof visualElement.options)[3]['shape']['props'];
};

export const catalog = defineCatalog(schema, {
  components: {
    BarChart: { props: byType.BarChart, description: 'Bar chart; one panel per currency' },
    LineChart: { props: byType.LineChart, description: 'Line chart; one panel per currency' },
    Table: { props: byType.Table, description: 'Table of rows' },
    Stat: { props: byType.Stat, description: 'A single headline number' },
  },
  actions: {},
});
