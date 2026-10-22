# MCP Screen Recording

OpenScreen exposes a local MCP server so an AI client can start a screen or window recording, stop it, export the loaded editor project, and receive a local file URL for the result.

## Architecture

The integration has two layers:

- `scripts/openscreen-mcp-server.mjs` is the MCP stdio server. MCP clients start this process and call its tools.
- `electron/mcpControlServer.ts` is a local HTTP control server inside the Electron app. It listens on `127.0.0.1:52347` by default and forwards MCP actions to the renderer through the preload bridge.

The renderer owns the actual recording and export behavior:

- `LaunchWindow` handles `list_sources`, `record_video`, `stop_recording`, and recording status.
- `VideoEditor` handles `export_video` and editor status.
- The control server adds a `file://` URL whenever a successful result includes a filesystem path.

OpenScreen must be running before MCP tools can control it. The HTTP control server is local-only and is not exposed on the network.

## Configuration

From a source checkout, configure an MCP client to run the server with Node:

```json
{
  "mcpServers": {
    "openscreen": {
      "command": "node",
      "args": ["D:\\Code\\OpenScreen\\scripts\\openscreen-mcp-server.mjs"],
      "env": {
        "OPENSCREEN_MCP_CONTROL_URL": "http://127.0.0.1:52347"
      }
    }
  }
}
```

For local development, this is equivalent to:

```powershell
npm run mcp
```

Optional environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `OPENSCREEN_MCP_CONTROL_URL` | `http://127.0.0.1:52347` | URL used by the MCP stdio server to reach OpenScreen. |
| `OPENSCREEN_MCP_CONTROL_TOKEN` | unset | Shared bearer token. Set it on both the Electron app and MCP server to require authorization. |
| `OPENSCREEN_MCP_CONTROL_PORT` | `52347` | Port used by the Electron control server. Set it on the Electron app process. |

If `OPENSCREEN_MCP_CONTROL_TOKEN` is set, the MCP server sends:

```http
Authorization: Bearer <token>
```

## Tools

### `list_sources`

Lists available capture sources. Results include both screens and windows and can be used to choose a `sourceId`.

Input:

```json
{}
```

Typical result:

```json
{
  "success": true,
  "data": [
    {
      "id": "screen:0:0",
      "name": "Entire Screen",
      "type": "screen",
      "displayIndex": 0,
      "bounds": { "x": 0, "y": 0, "width": 1920, "height": 1080 }
    },
    {
      "id": "window:123456:0",
      "name": "Example App",
      "type": "window"
    }
  ]
}
```

### `record_video`

Starts recording. If no source is supplied, OpenScreen selects the current/default source. When `sourceType` is provided, OpenScreen can choose between a full screen and a window.

Input:

```json
{
  "guideMode": false,
  "sourceType": "screen",
  "sourceId": "screen:0:0",
  "sourceName": "Entire Screen",
  "displayIndex": 0
}
```

Fields:

| Field | Type | Description |
| --- | --- | --- |
| `guideMode` | boolean | Enables Guide Mode for the recording. |
| `sourceType` | `"screen"` or `"window"` | Restricts source selection to a screen/display or an app window. |
| `sourceId` | string | Exact source ID returned by `list_sources`. This has highest priority. |
| `sourceName` | string | Exact or partial source/window name used when `sourceId` is omitted. |
| `displayIndex` | number | Zero-based display index for screen capture. |

Source selection priority:

1. Exact `sourceId`
2. `displayIndex`
3. Exact or partial `sourceName`
4. First matching screen
5. First available source

Example: record the primary screen.

```json
{
  "sourceType": "screen",
  "displayIndex": 0
}
```

Example: record a specific window.

```json
{
  "sourceType": "window",
  "sourceName": "Chrome"
}
```

### `stop_recording`

Stops the active recording. The saved video path and URL are returned when the recording is kept.

Input:

```json
{
  "discard": false
}
```

Typical result:

```json
{
  "success": true,
  "path": "C:\\Users\\user\\AppData\\Roaming\\openscreen\\recordings\\recording-123.mp4",
  "url": "file:///C:/Users/user/AppData/Roaming/openscreen/recordings/recording-123.mp4"
}
```

Use `"discard": true` to cancel and remove the recording instead of saving it.

### `export_video`

Exports the currently loaded editor project. If `outputPath` is omitted, OpenScreen writes to the user's Downloads folder and returns the generated path and URL.

Input:

```json
{
  "outputPath": "C:\\Users\\user\\Downloads\\demo.mp4",
  "format": "mp4",
  "quality": "good"
}
```

Fields:

| Field | Type | Description |
| --- | --- | --- |
| `outputPath` | string | Absolute output path. Defaults to Downloads. |
| `format` | `"mp4"` or `"gif"` | Export format. Defaults to `mp4`. |
| `quality` | `"medium"`, `"good"`, or `"source"` | MP4 quality preset. Defaults to `good`. |

Typical result:

```json
{
  "success": true,
  "path": "C:\\Users\\user\\Downloads\\demo.mp4",
  "url": "file:///C:/Users/user/Downloads/demo.mp4"
}
```

### `status`

Returns whether OpenScreen is currently recording. In the editor it also reports whether the editor is ready.

Input:

```json
{}
```

Typical result:

```json
{
  "success": true,
  "recording": false
}
```

## Recommended Workflow

1. Start OpenScreen.
2. Call `list_sources`.
3. Pick a source:
   - Use `sourceType: "screen"` plus `displayIndex` for a monitor.
   - Use `sourceType: "window"` plus `sourceId` or `sourceName` for an app window.
4. Call `record_video`.
5. Call `status` if the client needs to verify recording state.
6. Call `stop_recording`.
7. Optionally call `export_video` after OpenScreen opens the editor for the saved recording.
8. Use the returned `url` field as the exported video URL.

## Direct Control API

The MCP server is the supported integration surface, but the Electron app also exposes the local control endpoints used by the MCP server:

| Endpoint | Method | Action |
| --- | --- | --- |
| `/health` | `GET` | Returns whether the local OpenScreen control server is alive. |
| `/mcp/list_sources` | `POST` | Lists screen/window sources. |
| `/mcp/record_video` | `POST` | Starts recording. |
| `/mcp/stop_recording` | `POST` | Stops or discards recording. |
| `/mcp/export_video` | `POST` | Exports the current editor project. |
| `/mcp/status` | `POST` | Returns recording/editor status. |

PowerShell health check:

```powershell
Invoke-WebRequest -Uri "http://127.0.0.1:52347/health" -UseBasicParsing
```

Direct recording example:

```powershell
$body = @{
  sourceType = "screen"
  displayIndex = 0
} | ConvertTo-Json

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:52347/mcp/record_video" `
  -ContentType "application/json" `
  -Body $body
```

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `OpenScreen window is not available` | Electron app is not running or not ready. | Start OpenScreen and wait for the window to load. |
| `Unauthorized` | Token mismatch. | Set the same `OPENSCREEN_MCP_CONTROL_TOKEN` for both OpenScreen and the MCP server. |
| `Unsupported MCP action` | Wrong endpoint/tool name. | Use one of the documented tool names. |
| Timeout while handling an action | Renderer did not respond within 120 seconds. | Bring OpenScreen to the foreground, check the selected source, and retry. |
| Export returns an error | No editor project is loaded. | Stop a recording first or open a recording in the editor before exporting. |

## Security Notes

- The control server binds to `127.0.0.1` only.
- Set `OPENSCREEN_MCP_CONTROL_TOKEN` when multiple local processes or users can reach the machine.
- Do not expose the control port through a tunnel or reverse proxy.
- Treat returned file URLs as local machine paths; they are not public web URLs.
