#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

OPSTACK_UPSTREAM_REPO_URL_DEFAULT="https://github.com/ethereum-optimism/docs.git"
OPSTACK_UPSTREAM_REF_DEFAULT="f4da86bd742a4a88f41ccbeed54b62a98983d1dd"
OPSTACK_OP_DEPLOYER_REF_DEFAULT="op-deployer/v0.6.0-rc.3"
OPSTACK_OPTIMISM_REF_DEFAULT="op-program/v1.9.0"
UPSTREAM_SUBDIR="create-l2-rollup-example"

FORCE_FETCH=0
TMP_ROOT=''

log_info() {
  printf '[INFO] %s\n' "$1" >&2
}

log_error() {
  printf '[ERROR] %s\n' "$1" >&2
}

fail() {
  log_error "$1"
  exit 1
}

print_help() {
  cat <<'EOF_HELP'
Fetch pinned OP Stack upstream example into local cache.

Usage:
  ./scripts/fetch-opstack.sh [options]

Options:
  --force       Re-fetch even when cache already exists
  -h, --help    Show help

Environment:
  OPSTACK_UPSTREAM_REPO_URL  (default: https://github.com/ethereum-optimism/docs.git)
  OPSTACK_UPSTREAM_REF       (default: pinned commit in this script)
  OPSTACK_OP_DEPLOYER_REF    (default: pinned op-deployer release tag)
  OPSTACK_OPTIMISM_REF       (default: pinned optimism ref for op-program prestate)
  OPSTACK_PATCH_DIR          (default: <opstack-dir>/patches)

Output:
  Prints fetched example directory path to stdout.
EOF_HELP
}

require_cmd() {
  local cmd="$1"
  command -v "$cmd" >/dev/null 2>&1 || fail "Required command not found: ${cmd}. Install it and retry."
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --force)
        FORCE_FETCH=1
        ;;
      -h|--help)
        print_help
        exit 0
        ;;
      *)
        fail "Unknown option: $1"
        ;;
    esac
    shift
  done
}

validate_ref() {
  local ref="$1"
  if [ -z "$ref" ]; then
    fail 'OPSTACK_UPSTREAM_REF is empty. Set a valid tag or commit SHA.'
  fi

  if [ "$ref" = "main" ] || [ "$ref" = "latest" ]; then
    fail "OPSTACK_UPSTREAM_REF='${ref}' is not allowed. Use a pinned tag or commit SHA."
  fi
}

validate_pinned_tool_ref() {
  local ref="$1"
  local name="$2"

  if [ -z "$ref" ]; then
    fail "${name} is empty. Set a pinned tag or commit SHA."
  fi

  if [ "$ref" = "main" ] || [ "$ref" = "latest" ]; then
    fail "${name}='${ref}' is not allowed. Use a pinned tag or commit SHA."
  fi
}

validate_required_files() {
  local target_dir="$1"
  local required=(
    "docker-compose.yml"
    "Makefile"
    ".example.env"
    "scripts/setup-rollup.sh"
    "scripts/download-op-deployer.sh"
  )

  local path
  for path in "${required[@]}"; do
    if [ ! -s "${target_dir}/${path}" ]; then
      fail "Required upstream file is missing or empty: ${path}. Run fetch with --force and verify OPSTACK_UPSTREAM_REF."
    fi
  done
}

apply_patches_if_any() {
  local target_dir="$1"
  local patch_dir="$2"

  if [ ! -d "$patch_dir" ]; then
    return 0
  fi

  local patches=()
  while IFS= read -r patch_file; do
    patches+=("$patch_file")
  done < <(find "$patch_dir" -maxdepth 1 -type f -name '*.patch' | sort)

  if [ ${#patches[@]} -eq 0 ]; then
    return 0
  fi

  require_cmd git

  log_info "Applying ${#patches[@]} patch(es) from ${patch_dir}"

  local patch_file
  for patch_file in "${patches[@]}"; do
    if ! (cd "$target_dir" && git apply "$patch_file"); then
      fail "Patch apply failed: ${patch_file}. Verify patch compatibility with OPSTACK_UPSTREAM_REF."
    fi
  done
}

rewrite_download_op_deployer_script() {
  local target_dir="$1"
  local op_deployer_ref="$2"
  local download_script="${target_dir}/scripts/download-op-deployer.sh"

  [ -f "$download_script" ] || fail "Required upstream file is missing: scripts/download-op-deployer.sh"

  cat > "$download_script" <<EOF_SCRIPT
#!/usr/bin/env bash

set -euo pipefail

OPSTACK_OP_DEPLOYER_REF_DEFAULT="${op_deployer_ref}"

log_info() {
  printf '[INFO] %s\n' "\$1"
}

log_error() {
  printf '[ERROR] %s\n' "\$1" >&2
}

fail() {
  log_error "\$1"
  exit 1
}

require_cmd() {
  local cmd="\$1"
  command -v "\$cmd" >/dev/null 2>&1 || fail "Required command not found: \${cmd}. Install it and retry."
}

detect_platform() {
  local os
  local arch

  case "\$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *) fail "Unsupported OS: \$(uname -s)" ;;
  esac

  case "\$(uname -m)" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64) arch="amd64" ;;
    *) fail "Unsupported architecture: \$(uname -m)" ;;
  esac

  printf '%s-%s\n' "\$os" "\$arch"
}

main() {
  require_cmd curl
  require_cmd jq
  require_cmd tar

  local tag_name="\${OPSTACK_OP_DEPLOYER_REF:-\${OPSTACK_OP_DEPLOYER_REF_DEFAULT}}"
  if [ -z "\$tag_name" ]; then
    fail 'OPSTACK_OP_DEPLOYER_REF is empty. Set a pinned op-deployer release tag.'
  fi

  if [ "\$tag_name" = "main" ] || [ "\$tag_name" = "latest" ]; then
    fail "OPSTACK_OP_DEPLOYER_REF='\${tag_name}' is not allowed. Use a pinned release tag."
  fi

  local platform
  platform="\$(detect_platform)"
  local releases_api="https://api.github.com/repos/ethereum-optimism/optimism/releases/tags/\${tag_name}"

  log_info "Using pinned op-deployer release: \${tag_name}"
  log_info "Detecting platform: \${platform}"

  local release_info
  if ! release_info="\$(curl -fsSL "\$releases_api")"; then
    fail "Failed to fetch release info for '\${tag_name}'. Check OPSTACK_OP_DEPLOYER_REF and network access."
  fi

  local asset_name
  asset_name="\$(echo "\$release_info" | jq -r --arg platform "\$platform" '.assets[] | select((.name | contains("op-deployer")) and (.name | contains(\$platform))) | .name' | head -n 1)"

  if [ -z "\$asset_name" ]; then
    fail "No op-deployer asset found for platform '\${platform}' in release '\${tag_name}'."
  fi

  local download_url
  download_url="\$(echo "\$release_info" | jq -r --arg name "\$asset_name" '.assets[] | select(.name == \$name) | .browser_download_url')"
  [ -n "\$download_url" ] || fail "Could not resolve download URL for asset '\${asset_name}'."

  log_info "Downloading \${asset_name}"
  curl -fL -o op-deployer.tar.gz "\$download_url" || fail 'Failed to download op-deployer archive.'

  tar -xzf op-deployer.tar.gz || fail 'Failed to extract op-deployer archive.'

  local binary_path
  binary_path="\$(find . -maxdepth 4 -type f -name 'op-deployer*' ! -name '*.tar.gz' ! -path './scripts/*' | head -n 1)"
  [ -n "\$binary_path" ] || fail 'Could not locate op-deployer binary after extraction.'

  mv "\$binary_path" ./op-deployer || fail 'Failed to place op-deployer binary in runtime directory.'
  chmod +x ./op-deployer || fail 'Failed to set execute permission on op-deployer binary.'
  rm -f op-deployer.tar.gz

  ./op-deployer --version >/dev/null 2>&1 || fail 'Downloaded op-deployer binary failed --version check.'
  log_info "op-deployer ready: \$(./op-deployer --version)"
}

main "\$@"
EOF_SCRIPT

  chmod +x "$download_script" || fail 'Failed to set execute permission on rewritten download-op-deployer.sh.'
}

apply_builtin_compat_patches() {
  local target_dir="$1"
  local op_deployer_ref="$2"
  local optimism_ref="$3"
  local setup_script="${target_dir}/scripts/setup-rollup.sh"

  [ -f "$setup_script" ] || fail "Required upstream file is missing: scripts/setup-rollup.sh"
  rewrite_download_op_deployer_script "$target_dir" "$op_deployer_ref"

  if ! grep -Fq 'operatorFeeVaultRecipient = .*|operatorFeeVaultRecipient = \"$SEQUENCER_FEE_VAULT_ADDR\"|' "$setup_script" || \
     ! grep -Fq 'chainFeesRecipient = .*|chainFeesRecipient = \"$SEQUENCER_FEE_VAULT_ADDR\"|' "$setup_script"; then
    local tmp_file="${setup_script}.tmp"

    if ! awk '
      BEGIN { inserted = 0; anchor = 0 }
      {
        print
        if (index($0, "sequencerFeeVaultRecipient = .*") > 0) {
          anchor = 1
          print "    sed -i.bak \"s|operatorFeeVaultRecipient = .*|operatorFeeVaultRecipient = \\\"$SEQUENCER_FEE_VAULT_ADDR\\\"|\" .deployer/intent.toml"
          print "    sed -i.bak \"s|chainFeesRecipient = .*|chainFeesRecipient = \\\"$SEQUENCER_FEE_VAULT_ADDR\\\"|\" .deployer/intent.toml"
          inserted = 1
        }
      }
      END {
        if (anchor == 0 || inserted == 0) {
          exit 2
        }
      }
    ' "$setup_script" > "$tmp_file"; then
      rm -f "$tmp_file" || true
      fail "Failed to patch setup-rollup.sh for op-deployer compatibility. Check OPSTACK_UPSTREAM_REF and retry."
    fi

    mv "$tmp_file" "$setup_script" || fail "Failed to update setup-rollup.sh with compatibility patch."
    chmod +x "$setup_script" || fail "Failed to restore execute permission on patched setup-rollup.sh."
  fi

  if ! grep -Fq 'operatorFeeVaultRecipient = .*|operatorFeeVaultRecipient = \"$SEQUENCER_FEE_VAULT_ADDR\"|' "$setup_script"; then
    fail 'Compatibility patch verification failed: operatorFeeVaultRecipient replacement missing.'
  fi

  if ! grep -Fq 'chainFeesRecipient = .*|chainFeesRecipient = \"$SEQUENCER_FEE_VAULT_ADDR\"|' "$setup_script"; then
    fail 'Compatibility patch verification failed: chainFeesRecipient replacement missing.'
  fi

  # op-program custom config naming compatibility:
  # Newer versions require <chain-id>-genesis-l2.json (not <chain-id>-genesis.json).
  if ! grep -Fq 'cp "$DEPLOYER_DIR/.deployer/genesis.json" "op-program/chainconfig/configs/${CHAIN_ID}-genesis-l2.json"' "$setup_script"; then
    if ! sed -i.bak \
      's|cp "$DEPLOYER_DIR/.deployer/genesis.json" "op-program/chainconfig/configs/${CHAIN_ID}-genesis.json"|cp "$DEPLOYER_DIR/.deployer/genesis.json" "op-program/chainconfig/configs/${CHAIN_ID}-genesis-l2.json"|' \
      "$setup_script"; then
      fail 'Failed to patch genesis config filename for op-program compatibility.'
    fi
  fi

  local need_chain_cleanup=0
  local need_legacy_cleanup=0
  local cleanup_tmp_file="${setup_script}.cleanup.tmp"

  if ! grep -Fq 'rm -f "op-program/chainconfig/configs/${CHAIN_ID}-rollup.json"' "$setup_script"; then
    need_chain_cleanup=1
  fi
  if ! grep -Fq 'rm -f op-program/chainconfig/configs/*-genesis.json' "$setup_script"; then
    need_legacy_cleanup=1
  fi

  if [ "$need_chain_cleanup" -eq 1 ] || [ "$need_legacy_cleanup" -eq 1 ]; then
    if ! awk -v need_chain_cleanup="$need_chain_cleanup" -v need_legacy_cleanup="$need_legacy_cleanup" '
      BEGIN { inserted = 0 }
      {
        print
        if (inserted == 0 && index($0, "mkdir -p op-program/chainconfig/configs") > 0) {
          if (need_legacy_cleanup == 1) {
            print "    rm -f op-program/chainconfig/configs/*-genesis.json"
          }
          if (need_chain_cleanup == 1) {
            print "    rm -f \"op-program/chainconfig/configs/${CHAIN_ID}-rollup.json\" \\"
            print "      \"op-program/chainconfig/configs/${CHAIN_ID}-genesis.json\" \\"
            print "      \"op-program/chainconfig/configs/${CHAIN_ID}-genesis-l2.json\""
          }
          inserted = 1
        }
      }
      END {
        if (inserted == 0) {
          exit 2
        }
      }
    ' "$setup_script" > "$cleanup_tmp_file"; then
      rm -f "$cleanup_tmp_file" || true
      fail 'Failed to patch prestate config cleanup block for op-program compatibility.'
    fi

    mv "$cleanup_tmp_file" "$setup_script" || fail 'Failed to write patched setup-rollup.sh cleanup block.'
    chmod +x "$setup_script" || fail 'Failed to restore execute permission on patched setup-rollup.sh.'
  fi

  if ! grep -Fq 'cp "$DEPLOYER_DIR/.deployer/genesis.json" "op-program/chainconfig/configs/${CHAIN_ID}-genesis-l2.json"' "$setup_script"; then
    fail 'Compatibility patch verification failed: genesis-l2 config copy is missing.'
  fi
  if grep -Fq 'cp "$DEPLOYER_DIR/.deployer/genesis.json" "op-program/chainconfig/configs/${CHAIN_ID}-genesis.json"' "$setup_script"; then
    fail 'Compatibility patch verification failed: legacy genesis config filename is still present.'
  fi
  if ! grep -Fq 'rm -f op-program/chainconfig/configs/*-genesis.json' "$setup_script"; then
    fail 'Compatibility patch verification failed: legacy genesis cleanup line is missing.'
  fi

  # Replace dynamic latest-tag selection with pinned optimism ref.
  local op_program_selector='OP_PROGRAM_TAG=$(git tag --list "op-program/v*" | sort -V | tail -1)'
  local op_program_override="        OP_PROGRAM_TAG=\"\${OPSTACK_OPTIMISM_REF:-${optimism_ref}}\""
  local latest_selector='LATEST_TAG=$(git tag --list "op-program/v*" | sort -V | tail -1)'
  local latest_override="        LATEST_TAG=\"\${OPSTACK_OPTIMISM_REF:-${optimism_ref}}\""

  if ! sed -i.bak '/^[[:space:]]*OP_PROGRAM_TAG="\${OPSTACK_OPTIMISM_REF:-.*}"$/d' "$setup_script"; then
    fail 'Failed to remove existing OP_PROGRAM_TAG overrides before applying pinned ref.'
  fi
  if ! sed -i.bak '/^[[:space:]]*LATEST_TAG="\${OPSTACK_OPTIMISM_REF:-.*}"$/d' "$setup_script"; then
    fail 'Failed to remove existing LATEST_TAG overrides before applying pinned ref.'
  fi

  local optimism_tmp="${setup_script}.optimism.tmp"
  if ! awk -v op_selector="$op_program_selector" -v op_line="$op_program_override" -v latest_selector="$latest_selector" -v latest_line="$latest_override" '
    BEGIN { op_inserted = 0; latest_inserted = 0 }
    {
      print
      if (index($0, op_selector) > 0) {
        print op_line
        op_inserted = 1
      }
      if (index($0, latest_selector) > 0) {
        print latest_line
        latest_inserted = 1
      }
    }
    END {
      if (op_inserted == 0 || latest_inserted == 0) {
        exit 2
      }
    }
  ' "$setup_script" > "$optimism_tmp"; then
    rm -f "$optimism_tmp" || true
    fail 'Failed to patch OPSTACK_OPTIMISM_REF overrides into setup-rollup.sh.'
  fi

  mv "$optimism_tmp" "$setup_script" || fail 'Failed to write OPSTACK_OPTIMISM_REF overrides.'
  chmod +x "$setup_script" || fail 'Failed to restore execute permission on patched setup-rollup.sh.'

  if ! grep -Fq "$op_program_override" "$setup_script"; then
    fail 'Compatibility patch verification failed: OP_PROGRAM_TAG pinned override is missing.'
  fi
  if ! grep -Fq "$latest_override" "$setup_script"; then
    fail 'Compatibility patch verification failed: LATEST_TAG pinned override is missing.'
  fi

  # Ensure Docker local-export target exists for op-program reproducible-prestate.
  if ! grep -Fq 'mkdir -p op-program/bin' "$setup_script"; then
    local prestate_tmp="${setup_script}.prestate.tmp"
    if ! awk '
      BEGIN { inserted = 0 }
      {
        if (index($0, "make reproducible-prestate") > 0 && inserted == 0) {
          print "    mkdir -p op-program/bin"
          inserted = 1
        }
        print
      }
      END {
        if (inserted == 0) {
          exit 2
        }
      }
    ' "$setup_script" > "$prestate_tmp"; then
      rm -f "$prestate_tmp" || true
      fail 'Failed to patch reproducible-prestate bin directory bootstrap.'
    fi
    mv "$prestate_tmp" "$setup_script" || fail 'Failed to write reproducible-prestate bootstrap patch.'
    chmod +x "$setup_script" || fail 'Failed to restore execute permission on patched setup-rollup.sh.'
  fi

  if ! grep -Fq 'mkdir -p op-program/bin' "$setup_script"; then
    fail 'Compatibility patch verification failed: reproducible-prestate bin bootstrap line is missing.'
  fi

  # op-node v1.13.x compatibility:
  # remove rollup.json fields not recognized by older op-node.
  local rollup_norm_jq="jq 'del(.minBaseFee, .genesis.system_config.minBaseFee, .genesis.system_config.daFootprintGasScalar, .genesis.system_config.operatorFeeParams)' .deployer/rollup.json > .deployer/rollup.json.tmp"
  local legacy_rollup_norm_jq="jq 'del(.minBaseFee)' .deployer/rollup.json > .deployer/rollup.json.tmp"
  local intermediate_rollup_norm_jq="jq 'del(.minBaseFee, .genesis.system_config.minBaseFee)' .deployer/rollup.json > .deployer/rollup.json.tmp"

  if grep -Fq "$legacy_rollup_norm_jq" "$setup_script"; then
    if ! sed -i.bak \
      "s|jq 'del(.minBaseFee)' .deployer/rollup.json > .deployer/rollup.json.tmp|jq 'del(.minBaseFee, .genesis.system_config.minBaseFee, .genesis.system_config.daFootprintGasScalar, .genesis.system_config.operatorFeeParams)' .deployer/rollup.json > .deployer/rollup.json.tmp|" \
      "$setup_script"; then
      fail 'Failed to replace legacy rollup.json normalization patch.'
    fi
  fi

  if grep -Fq "$intermediate_rollup_norm_jq" "$setup_script"; then
    if ! sed -i.bak "/jq 'del(.minBaseFee, .genesis.system_config.minBaseFee)' .deployer\\/rollup.json > .deployer\\/rollup.json.tmp/d" "$setup_script"; then
      fail 'Failed to remove intermediate rollup.json normalization patch.'
    fi
  fi
  if grep -Fq 'log_info "Normalized rollup.json for op-node compatibility (removed unsupported system_config fields)."' "$setup_script"; then
    if ! sed -i.bak '/log_info "Normalized rollup.json for op-node compatibility (removed unsupported system_config fields)."/,+2{/mv \.deployer\/rollup\.json\.tmp \.deployer\/rollup\.json/d;}' "$setup_script"; then
      fail 'Failed to remove stale duplicate rollup mv line.'
    fi
  fi
  if grep -Fq 'log_info "Normalized rollup.json for op-node compatibility (removed minBaseFee)."' "$setup_script"; then
    if ! sed -i.bak '/log_info "Normalized rollup.json for op-node compatibility (removed minBaseFee)."/d' "$setup_script"; then
      fail 'Failed to remove stale rollup normalization log line.'
    fi
  fi

  if ! grep -Fq "$rollup_norm_jq" "$setup_script"; then
    local rollup_tmp="${setup_script}.rollup.tmp"
    if ! awk '
      BEGIN { inserted = 0 }
      {
        print
        if (index($0, "op-deployer inspect rollup --workdir .deployer \"$L2_CHAIN_ID\" > .deployer/rollup.json") > 0) {
          print "    jq '\''del(.minBaseFee, .genesis.system_config.minBaseFee, .genesis.system_config.daFootprintGasScalar, .genesis.system_config.operatorFeeParams)'\'' .deployer/rollup.json > .deployer/rollup.json.tmp"
          print "    mv .deployer/rollup.json.tmp .deployer/rollup.json"
          print "    log_info \"Normalized rollup.json for op-node compatibility (removed unsupported system_config fields).\""
          inserted = 1
        }
      }
      END {
        if (inserted == 0) {
          exit 2
        }
      }
    ' "$setup_script" > "$rollup_tmp"; then
      rm -f "$rollup_tmp" || true
      fail 'Failed to patch rollup.json normalization for op-node compatibility.'
    fi
    mv "$rollup_tmp" "$setup_script" || fail 'Failed to write rollup.json normalization patch.'
    chmod +x "$setup_script" || fail 'Failed to restore execute permission on patched setup-rollup.sh.'
  fi

  if ! grep -Fq "$rollup_norm_jq" "$setup_script"; then
    fail 'Compatibility patch verification failed: rollup minBaseFee normalization line is missing.'
  fi

  log_info 'Applied built-in compatibility patches for pinned op-deployer/op-program toolchain.'
}

main() {
  parse_args "$@"

  require_cmd git

  local upstream_repo_url="${OPSTACK_UPSTREAM_REPO_URL:-$OPSTACK_UPSTREAM_REPO_URL_DEFAULT}"
  local upstream_ref="${OPSTACK_UPSTREAM_REF:-$OPSTACK_UPSTREAM_REF_DEFAULT}"
  local op_deployer_ref="${OPSTACK_OP_DEPLOYER_REF:-$OPSTACK_OP_DEPLOYER_REF_DEFAULT}"
  local optimism_ref="${OPSTACK_OPTIMISM_REF:-$OPSTACK_OPTIMISM_REF_DEFAULT}"
  local patch_dir="${OPSTACK_PATCH_DIR:-${WORK_DIR}/patches}"

  validate_ref "$upstream_ref"
  validate_pinned_tool_ref "$op_deployer_ref" "OPSTACK_OP_DEPLOYER_REF"
  validate_pinned_tool_ref "$optimism_ref" "OPSTACK_OPTIMISM_REF"

  local cache_root="${WORK_DIR}/.cache/opstack"
  local target_dir="${cache_root}/${upstream_ref}/${UPSTREAM_SUBDIR}"
  local marker_file="${target_dir}/.fetch-ok"

  if [ "$FORCE_FETCH" -eq 0 ] && [ -f "$marker_file" ]; then
    validate_required_files "$target_dir"
    apply_builtin_compat_patches "$target_dir" "$op_deployer_ref" "$optimism_ref"
    apply_patches_if_any "$target_dir" "$patch_dir"
    printf '%s\n' "$target_dir"
    exit 0
  fi

  mkdir -p "$cache_root"

  TMP_ROOT="$(mktemp -d "${cache_root}/.tmp-fetch.XXXXXX")"
  trap 'if [ -n "${TMP_ROOT:-}" ] && [ -d "${TMP_ROOT}" ]; then rm -rf "${TMP_ROOT}"; fi' EXIT

  local tmp_repo="${TMP_ROOT}/repo"
  local tmp_target="${TMP_ROOT}/target"

  log_info "Fetching upstream source: ${upstream_repo_url} @ ${upstream_ref}"

  git init -q "$tmp_repo"
  git -C "$tmp_repo" remote add origin "$upstream_repo_url"

  if ! git -C "$tmp_repo" fetch --depth 1 origin "$upstream_ref" >/dev/null 2>&1; then
    fail "Failed to fetch ref '${upstream_ref}'. Check network access and OPSTACK_UPSTREAM_REF value."
  fi

  git -C "$tmp_repo" checkout -q FETCH_HEAD

  if [ ! -d "${tmp_repo}/${UPSTREAM_SUBDIR}" ]; then
    fail "Upstream directory '${UPSTREAM_SUBDIR}' not found at ref '${upstream_ref}'."
  fi

  mkdir -p "$tmp_target"
  cp -R "${tmp_repo}/${UPSTREAM_SUBDIR}/." "$tmp_target/"

  validate_required_files "$tmp_target"
  apply_builtin_compat_patches "$tmp_target" "$op_deployer_ref" "$optimism_ref"
  apply_patches_if_any "$tmp_target" "$patch_dir"

  mkdir -p "$(dirname "$target_dir")"
  rm -rf "$target_dir"
  mkdir -p "$target_dir"
  cp -R "$tmp_target/." "$target_dir/"

  printf 'ref=%s\nrepo=%s\nop_deployer_ref=%s\noptimism_ref=%s\n' \
    "$upstream_ref" "$upstream_repo_url" "$op_deployer_ref" "$optimism_ref" > "$marker_file"

  log_info "Upstream example cached at ${target_dir}"
  printf '%s\n' "$target_dir"
}

main "$@"
