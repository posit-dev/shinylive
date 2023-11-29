# Building requires "submodules=1" to be passed to nix build. For example:
#    nix build ".?submodules=1"
#    nix build "github:posit-dev/shinylive?submodules=1"
{
  description = "Shinylive web assets";

  inputs = { nixpkgs.url = "github:NixOS/nixpkgs/nixos-23.05"; };

  outputs = { self, nixpkgs }:
    let
      supportedSystems =
        [ "x86_64-linux" "aarch64-darwin" "x86_64-darwin" "aarch64-linux" ];
      forEachSupportedSystem = f:
        nixpkgs.lib.genAttrs supportedSystems (system:
          f rec {
            pkgs = import nixpkgs { inherit system; };
            inherit system;
          });

    in {
      packages = forEachSupportedSystem ({ pkgs, system, ... }: {
        default = pkgs.stdenv.mkDerivation rec {
          name = "shinylive";
          src = ./.;

          # TODO:
          # - cache yarn packages

          pyodide-version = "0.22.1";

          pyodide-tarball = pkgs.fetchurl {
            url =
              "https://github.com/pyodide/pyodide/releases/download/${pyodide-version}/pyodide-${pyodide-version}.tar.bz2";
            sha256 = "sha256-2Ys+ifzjRVjZ7OLO30DyjttWXAuFW1xupAXIhGyeFgU=";
          };

          # Cached npm dependencies specified by src/package-lock.json. During
          # development, whenever package-lock.json is updated, the hash needs
          # to be updated. To find the hash, run:
          #     prefetch-npm-deps package-lock.json
          npm-deps = pkgs.fetchNpmDeps {
            inherit src;
            hash = "sha256-EE883j16RBHg0rhkNqIpRJDnwNVaWfbtx+L8LAY7GMk=";
          };

          configurePhase = ''
            npm config set cache "${npm-deps}" --location project
            npm config set offline true --location project
            npm config set progress false --location project
          '';

          preBuild = ''
            mkdir -p downloads
            cp ${pyodide-tarball} downloads/
          '';

          nativeBuildInputs = with pkgs; [
            nodejs_20
            python311
            (with python311Packages; [ pip virtualenv ])
            curl
            cacert
            git
          ];

          buildPhase = ''
            export HOME=$PWD
            make all
          '';

          installPhase = ''
            mkdir -p $out
            cp -r build/* $out
          '';
        };
      });

      devShells = forEachSupportedSystem ({ pkgs, system }: {
        default = pkgs.mkShell {

          # Get the nativeBuildInputs from packages.default
          inputsFrom = [ self.packages.${system}.default ];

          packages = with pkgs; [ prefetch-npm-deps ];
        };
      });
    };
}
