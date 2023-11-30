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
        default = pkgs.stdenv.mkDerivation {
          name = "shinylive";
          src = ./.;

          # TODO:
          # - cache yarn packages
          # - cache pyodide tarball

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

          packages = with pkgs; [ ];
        };
      });
    };
}
