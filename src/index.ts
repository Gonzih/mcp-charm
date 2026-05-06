#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = "https://charm.li";
const JINA_PREFIX = "https://r.jina.ai/";

/**
 * Fetch a charm.li page via jina.ai for clean markdown output.
 */
async function fetchMarkdown(url: string): Promise<string> {
  const jinaUrl = `${JINA_PREFIX}${url}`;
  const response = await fetch(jinaUrl, {
    headers: {
      "User-Agent": "mcp-charm/0.1.0 (https://github.com/gonzih/mcp-charm)",
      Accept: "text/plain",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response.text();
}

interface LinkEntry {
  text: string;
  url: string;
}

/**
 * Extract markdown links from content, filtering for charm.li URLs only.
 * Skips navigation links (Home, About) and javascript: links.
 */
function extractCharmLinks(markdown: string, pathPrefix?: string): LinkEntry[] {
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/charm\.li\/[^)]+)\)/g;
  const seen = new Set<string>();
  const results: LinkEntry[] = [];

  let match: RegExpExecArray | null;
  while ((match = linkPattern.exec(markdown)) !== null) {
    const text = match[1].trim();
    const url = match[2].trim();

    // Skip navigation/breadcrumb links
    if (text === "Home" || text === "About Operation CHARM") continue;
    // Skip if we have a prefix filter and URL doesn't match
    if (pathPrefix && !url.startsWith(pathPrefix)) continue;
    // Skip duplicates
    if (seen.has(url)) continue;

    seen.add(url);
    results.push({ text, url });
  }

  return results;
}

/**
 * Validate that a URL starts with https://charm.li/ for safety.
 */
function validateCharmUrl(url: string): void {
  if (!url.startsWith(`${BASE_URL}/`)) {
    throw new Error(
      `URL must start with ${BASE_URL}/ — got: ${url}`
    );
  }
}

/**
 * Build a charm.li URL from a path, ensuring proper encoding.
 */
function charmUrl(path: string): string {
  // Normalize: remove leading slash, ensure no double slashes
  const normalized = path.replace(/^\/+/, "").replace(/\/+$/, "");
  return `${BASE_URL}/${normalized}/`;
}

const server = new McpServer({
  name: "mcp-charm",
  version: "0.1.0",
});

// Tool 1: list_makes
server.registerTool(
  "list_makes",
  {
    description:
      "List all car makes available on charm.li (Operation CHARM free service manuals). Returns an array of make names like Acura, BMW, Ford, Toyota, etc.",
    inputSchema: {},
  },
  async () => {
    const markdown = await fetchMarkdown(BASE_URL + "/");
    const links = extractCharmLinks(markdown, `${BASE_URL}/`);

    // Top-level makes are direct children: charm.li/Make/ (no further slashes in path)
    const makes = links
      .filter((link) => {
        const path = link.url.replace(`${BASE_URL}/`, "").replace(/\/$/, "");
        return path.length > 0 && !path.includes("/");
      })
      .map((link) => ({
        name: link.text,
        url: link.url,
      }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              makes: makes.map((m) => m.name),
              count: makes.length,
              details: makes,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool 2: browse_make
server.registerTool(
  "browse_make",
  {
    description:
      "Browse available years for a given car make on charm.li. For example, browse_make('Ford') returns all years (1982–2013) for which Ford manuals exist. Use browse_manuals with a year path to see models for that year.",
    inputSchema: {
      make: z
        .string()
        .min(1)
        .describe(
          'Car make name, e.g. "Ford", "BMW", "Toyota". Use list_makes to see all available makes.'
        ),
    },
  },
  async ({ make }) => {
    const url = charmUrl(make);
    const markdown = await fetchMarkdown(url);
    const prefix = `${BASE_URL}/${encodeURIComponent(make)}/`;
    const links = extractCharmLinks(markdown, `${BASE_URL}/`);

    // Filter to direct children of this make
    const entries = links
      .filter((link) => {
        const withoutBase = link.url.replace(`${BASE_URL}/`, "");
        const parts = withoutBase.replace(/\/$/, "").split("/");
        return parts.length === 2; // make/year
      })
      .map((link) => ({
        label: link.text,
        url: link.url,
        path: link.url.replace(`${BASE_URL}/`, "").replace(/\/$/, ""),
      }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              make,
              url,
              entries,
              count: entries.length,
              note: `Use browse_manuals with path like "${make}/2010" to see models for a specific year.`,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool 3: browse_manuals
server.registerTool(
  "browse_manuals",
  {
    description:
      'Browse manuals at a specific path on charm.li. Use paths like "Ford/2010" to see model+engine combos, or "Ford/2010/Crown Victoria V8-4.6L" to see manual sections (Repair and Diagnosis, Parts and Labor).',
    inputSchema: {
      path: z
        .string()
        .min(1)
        .describe(
          'Path within charm.li, e.g. "Ford/2010", "Toyota/2005", "Ford/2010/Crown Victoria V8-4.6L". Do not include leading or trailing slashes.'
        ),
    },
  },
  async ({ path }) => {
    const url = charmUrl(path);
    const markdown = await fetchMarkdown(url);

    // Extract all charm.li links that are children of this path
    const links = extractCharmLinks(markdown, `${BASE_URL}/`);

    const entries = links
      .filter((link) => {
        // Must be a child of current path
        const normalized = url.replace(/\/$/, "");
        return (
          link.url.startsWith(normalized + "/") && link.url !== normalized + "/"
        );
      })
      .map((link) => {
        const relativePath = link.url
          .replace(url, "")
          .replace(/\/$/, "");
        const isDirectory = link.url.endsWith("/");
        return {
          name: link.text,
          url: link.url,
          path: path + "/" + relativePath,
          type: isDirectory ? "directory" : "file",
        };
      });

    // Also look for non-charm.li links that are downloadable files
    const filePattern = /\[([^\]]+)\]\((https?:\/\/charm\.li\/bundle\/[^)]+)\)/g;
    const bundles: Array<{ name: string; url: string; type: string }> = [];
    let match: RegExpExecArray | null;
    while ((match = filePattern.exec(markdown)) !== null) {
      bundles.push({
        name: match[1].trim(),
        url: match[2].trim(),
        type: "download",
      });
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              path,
              url,
              entries: [...entries, ...bundles],
              count: entries.length + bundles.length,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool 4: search_manuals
server.registerTool(
  "search_manuals",
  {
    description:
      "Search for service manuals by car make and optional keyword. If the query includes a 4-digit year (e.g. '2010'), only that year is searched. Otherwise, the most recent available years are searched. Returns matching model/manual entries with URLs.",
    inputSchema: {
      make: z
        .string()
        .min(1)
        .describe(
          'Car make to search within, e.g. "Ford", "Toyota". Use list_makes to see all available makes.'
        ),
      query: z
        .string()
        .optional()
        .describe(
          'Optional search keyword. Can be a year (e.g. "2010"), model name (e.g. "F-150"), engine (e.g. "V8"), or combination (e.g. "2010 F-150").'
        ),
    },
  },
  async ({ make, query }) => {
    // Step 1: Fetch make page to get available years
    const makeUrl = charmUrl(make);
    const makeMarkdown = await fetchMarkdown(makeUrl);
    const allLinks = extractCharmLinks(makeMarkdown, `${BASE_URL}/`);

    // Get year entries (2-level paths: make/year)
    const yearEntries = allLinks.filter((link) => {
      const withoutBase = link.url.replace(`${BASE_URL}/`, "");
      const parts = withoutBase.replace(/\/$/, "").split("/");
      return parts.length === 2;
    });

    if (yearEntries.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { make, query, results: [], note: "No years found for this make." },
              null,
              2
            ),
          },
        ],
      };
    }

    // Step 2: Determine which years to fetch
    let yearsToSearch: typeof yearEntries;
    if (query) {
      const yearMatch = query.match(/\b(19|20)\d{2}\b/);
      if (yearMatch) {
        const targetYear = yearMatch[0];
        yearsToSearch = yearEntries.filter((e) => e.text === targetYear);
        if (yearsToSearch.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    make,
                    query,
                    results: [],
                    note: `Year ${targetYear} not found for ${make}. Available years: ${yearEntries.map((e) => e.text).join(", ")}`,
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }
      } else {
        // No year in query — search most recent 5 years
        yearsToSearch = yearEntries.slice(-5);
      }
    } else {
      // No query — return the year listing
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                make,
                query: null,
                results: yearEntries.map((e) => ({
                  label: e.text,
                  url: e.url,
                  path: e.url.replace(`${BASE_URL}/`, "").replace(/\/$/, ""),
                })),
                count: yearEntries.length,
                note: `Showing available years for ${make}. Provide a query with a year or model name to search for specific manuals.`,
              },
              null,
              2
            ),
          },
        ],
      };
    }

    // Step 3: Fetch year pages and filter by query keyword
    const keyword = query
      .replace(/\b(19|20)\d{2}\b/, "")
      .trim()
      .toLowerCase();

    const results: Array<{ make: string; year: string; model: string; url: string; path: string }> = [];

    await Promise.all(
      yearsToSearch.map(async (yearEntry) => {
        const year = yearEntry.text;
        try {
          const yearMarkdown = await fetchMarkdown(yearEntry.url);
          const modelLinks = extractCharmLinks(yearMarkdown, `${BASE_URL}/`);

          // 3-level paths: make/year/model
          const modelEntries = modelLinks.filter((link) => {
            const withoutBase = link.url.replace(`${BASE_URL}/`, "");
            const parts = withoutBase.replace(/\/$/, "").split("/");
            return parts.length === 3;
          });

          for (const entry of modelEntries) {
            if (!keyword || entry.text.toLowerCase().includes(keyword)) {
              results.push({
                make,
                year,
                model: entry.text,
                url: entry.url,
                path: entry.url.replace(`${BASE_URL}/`, "").replace(/\/$/, ""),
              });
            }
          }
        } catch {
          // Skip years that fail to fetch
        }
      })
    );

    // Sort by year descending, then model name
    results.sort((a, b) => {
      const yearDiff = parseInt(b.year) - parseInt(a.year);
      if (yearDiff !== 0) return yearDiff;
      return a.model.localeCompare(b.model);
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              make,
              query,
              results,
              count: results.length,
              note:
                results.length === 0
                  ? `No manuals found matching "${query}" for ${make}.`
                  : undefined,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool 5: get_manual_content
server.registerTool(
  "get_manual_content",
  {
    description:
      "Fetch the content of a specific charm.li page — returns the page as markdown including links to manual sections and PDF files. The URL must start with https://charm.li/.",
    inputSchema: {
      url: z
        .string()
        .url()
        .describe(
          "Full URL of a charm.li page, e.g. https://charm.li/Ford/2010/Crown%20Victoria%20V8-4.6L/. Must start with https://charm.li/."
        ),
    },
  },
  async ({ url }) => {
    validateCharmUrl(url);
    const markdown = await fetchMarkdown(url);
    return {
      content: [
        {
          type: "text",
          text: markdown,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
