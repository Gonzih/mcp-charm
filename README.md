# mcp-charm

MCP server for **Operation CHARM** — free car service manuals from [charm.li](https://charm.li/).

Browse and search thousands of free car service manuals covering makes from Acura to Volvo, model years 1982 through 2013.

## Install

```bash
npx -y @gonzih/mcp-charm
```

## Claude Desktop Configuration

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "charm": {
      "command": "npx",
      "args": ["-y", "@gonzih/mcp-charm"]
    }
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `list_makes` | List all car makes available (Acura, BMW, Ford, Toyota, ...) |
| `browse_make` | Browse available years for a make (e.g. Ford → 1982–2013) |
| `browse_manuals` | Browse manuals at a specific path (e.g. `Ford/2010`) |
| `search_manuals` | Search for manuals by make + optional keyword/year |
| `get_manual_content` | Fetch the content of a specific charm.li page |

## Example Usage

```
list_makes
→ ["Acura", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet", ...]

browse_make("Ford")
→ Years: 1982, 1983, ..., 2013

browse_manuals("Ford/2010")
→ Crown Victoria V8-4.6L, E 150 V8-4.6L, F 150 2WD V8-4.6L, ...

search_manuals("Ford", "2010 F-150")
→ F 150 2WD V8-4.6L, F 150 4WD V8-4.6L, ...

get_manual_content("https://charm.li/Ford/2010/Crown%20Victoria%20V8-4.6L/")
→ Repair and Diagnosis, Parts and Labor, Download .zip
```

## About Operation CHARM

[Operation CHARM](https://charm.li/about.html) is a community project providing free car service manuals for everyone. Manuals cover 1982–2013 model years across 50+ makes.

## License

MIT
