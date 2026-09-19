# developer-runner

The disposable container the `factory` module runs the Developer agent in (execution spec
EX-P0). Build it once on the machine that runs the workers:

```sh
docker build -t om-developer-runner:local docker/developer-runner
```

Each run: the host clones the target repo into a temp dir, mounts it at `/work`, and runs
`opencode run` with only the model key in the environment. The host then reads the changed
files and opens the PR itself; the container never holds a GitHub credential.
