# Factory developer runner

Build the dedicated local image from the repository root:

```bash
docker build -f docker/factory-runner/Dockerfile -t om-factory-runner:local .
```

Set `FACTORY_DEVELOPER_RUNNER_IMAGE=om-factory-runner:local` for the app process that starts factory runs.
