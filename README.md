# CPGen Studio

A desktop app for building test case generation schemas for competitive programming problems, built with Tauri.

> **Status**: alpha (`0.2.5-alpha.1`). Expect breaking changes to the workspace/schema format until `1.0`. See [ROADMAP.md](./ROADMAP.md) for what's planned.

## What it does

CPGen Studio lets you visually build a schema of blocks that define how test cases are generated, then run that schema against a solution to produce test files. It's built for problem setters who want a faster, more visual alternative to hand-writing generator scripts.

> **Notes**
>
> - Workspace/schema file format will change before `1.0`, particularly once subtask support lands. I may or may not maintain backward compatibility.
> - This is a solo alpha project under active, sometimes breaking, development. Expect rough edges.
> - Issues and feedback are welcome but still it's a solo project so don't expect instant support.
> - If this project gets famous enough I'm pushing an update that leave backdoor on your device... If I ever implement auto-update in the first place.

## Development

```bash
npm install
npm run tauri dev
```

## Building

```bash
npm run tauri build
```

> Notes:
>
> - Cross-platform builds are not yet supported out of the box. Might update the backend to support unix file systems... one day.

## Contributing / working on this repo

This is currently a solo project in active alpha development. If you're picking up work here, first of all, _why?_ But do check [ROADMAP.md](./ROADMAP.md) first for planned features and sequencing before starting on something new.  
Thank you for the help!

## License

PolyForm Noncommercial License 1.0.0  
check [LICENSE](./LICENSE) for more details.
