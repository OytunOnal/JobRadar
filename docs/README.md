# Documentation

Four documents, each answering a different question. The [README](../README.md)
answers "what is this and how do I run it"; these answer the rest.

| | |
|---|---|
| [**SETUP.md**](SETUP.md) | *How do I run it properly?* Requirements, the first run step by step, every command worth knowing, how to point it at your own search, and how to upgrade without losing the database. |
| [**ARCHITECTURE.md**](ARCHITECTURE.md) | *Why is it built this way?* The layered data model, and twelve decision records — each one a trade-off with the measurement that settled it. Start here if you are reading the code. |
| [**../CONTEXT.md**](../CONTEXT.md) | *What do the words mean?* The glossary. Posting, pool, delisted, discoverable, band, chunk, lane, visa tier, kept text — every term the code uses, defined once, with the near-synonyms it deliberately avoids. |
| [**ROADMAP.md**](ROADMAP.md) | *Where is it going?* What is planned, and for the parts already thought through, the decisions behind them. |

Two more live next to the code they describe:
[`scripts/README.md`](../scripts/README.md) groups every script by who runs it,
and [`docs/agents/`](agents/) holds the conventions an agent working in this
repository is expected to follow.

Measurement reports also land here as they accumulate:
[`discovery-health.md`](discovery-health.md) tracks the sampled false-negative
rate of ATS board discovery, month by month.

## Reading order

If you are evaluating the project, the README and the diagrams in it are enough.

If you are going to change something, read `CONTEXT.md` first — it is short, and
almost every argument in `ARCHITECTURE.md` turns on a distinction the glossary
draws. A *delisted* posting and a *stale* one are not the same thing, and code
that confuses them has a bug the type system cannot see.
