# Redline

**A privacy firewall for AI chat.** Redline is a Chrome extension that uses Gemini Nano on-device (via Firebase AI Logic hybrid inference) to strip confidential details from text before you paste it into ChatGPT, Gemini or Claude. Only already-redacted text is ever sent to Gemini in the cloud, for a deeper re-identification risk check.

Built for the #BuildHybridAI 2026 hackathon (Web/Chrome track).

- Product spec: [PRD.md](PRD.md)
- Status: in development. Paste interception on AI chat sites, on-device redaction, meaning-preserving placeholders, local re-hydration and a 30-sample eval are working.
- Setup: [docs/SETUP.md](docs/SETUP.md)

## On-device model

Redline doesn't bundle or pick a model. It calls Firebase AI Logic, which uses Chrome's built-in Prompt API, and Chrome decides which Gemini Nano version runs on each device. Redline therefore runs on whichever Gemini Nano Chrome provides. It was tested on **Nano v3** (`nano_v3_gpu_low_tier_model`). **Gemini Nano 4 / Gemma 4-based** models are picked up automatically with no code change once Chrome rolls them out to a device. You can check yours at `chrome://on-device-internals`.

Accuracy on the 30-sample labelled eval (legal, medical, HR), measured on Nano v3:

| | Recall | Median latency |
|---|---|---|
| Pattern detectors only | 35.8% | instant |
| Patterns + Gemini Nano (3 runs) | 95.6% / 97.1% / 99.3% | ~5.5 s |

Run it on your own device at `/eval.html` (see [docs/SETUP.md](docs/SETUP.md)).

## License
Apache-2.0
