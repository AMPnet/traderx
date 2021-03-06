declare var process: Process

interface Process {
  // prebuild-time env variables
  env: PreBuildEnv;
}

interface PreBuildEnv {
  COMMIT_HASH: string
  APP_VERSION: string
}

export interface Window {
  // postbuild-time env variables, loaded on start-up
  env: PostBuildEnv
}

interface PostBuildEnv {
  BACKEND_URL: string
  MAGIC_API_KEY: string
  FIXED_CHAIN_ID: string
}
