{
  description = "A Nix-flake-based pnpm typescript development environment";

  # Make sure packages are in the binary cache
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      inherit (builtins) attrValues;

      supportedSystems = [ "x86_64-linux" ];

      forEachSupportedSystem = f:
        nixpkgs.lib.genAttrs supportedSystems (system:
          f {
            pkgs = import nixpkgs { inherit system; };
            inherit system;
          });

    in {
      devShells = forEachSupportedSystem ({ pkgs, system }: {
        default = pkgs.mkShell {
          packages = attrValues {
            # Nix
            inherit (pkgs) nil nixfmt;

            # Language Servers
            inherit (pkgs) yaml-language-server vscode-langservers-extracted;
            inherit (pkgs.nodePackages)
              typescript-language-server bash-language-server;

            # Node
            inherit (pkgs) nodejs_24;
            inherit (pkgs.nodePackages) pnpm;

            # Python (for stylelint)
            inherit (pkgs) python3;

            # Browser for testing
            inherit (pkgs) chromium;

            # CA bundle — see the shellHook
            inherit (pkgs) cacert;
          };

          shellHook = ''
            export PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH="${pkgs.chromium}/bin/chromium"
            export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

            # `wrangler dev` runs the workers in workerd, which uses its own TLS
            # stack and finds no trust store in a bare Nix shell: every outbound
            # fetch dies with "TLS peer's certificate is not trusted". The
            # calendar worker does nothing BUT an outbound fetch, so it cannot be
            # exercised locally without this. Pointed at Nix's own bundle rather
            # than /etc/ssl/certs, which is host-specific and absent on NixOS and
            # macOS.
            export SSL_CERT_FILE="${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
            export NODE_EXTRA_CA_CERTS="$SSL_CERT_FILE"
          '';
        };
      });
    };
}
