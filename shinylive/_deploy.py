import json
import os
import shutil
import sys

from typing import List

if sys.version_info >= (3, 8):
    from typing import TypedDict
else:
    from typing_extensions import TypedDict

# This is the same as the FileContent type in TypeScript.
class FileContent(TypedDict):
    name: str
    content: str


def deploy(app_dir: str, dest_dir: str) -> None:
    """
    Statically deploy a Shiny app.
    """

    shinylive_dir = os.path.join(os.path.dirname(__file__), "js")

    print(f"Copying {shinylive_dir} to {dest_dir}")
    shutil.copytree(shinylive_dir, dest_dir)

    app_files: List[FileContent] = []
    # Recursively iterate over files in app directory, and collect the files into
    # app_files data structure.
    exclude_names = {"__pycache__"}
    for root, dirs, files in os.walk(app_dir, topdown=True):
        dirs[:] = set(dirs) - exclude_names
        rel_dir = os.path.relpath(root, app_dir)
        for filename in files:
            if rel_dir == ".":
                output_filename = filename
            else:
                output_filename = os.path.join(rel_dir, filename)

            file_content = (
                open(os.path.join(root, filename), "rb").read().decode("utf-8")
            )

            app_files.append(
                {
                    "name": output_filename,
                    "content": file_content,
                }
            )

    app_json_output_file = os.path.join(dest_dir, "app.json")
    print("Writing to " + app_json_output_file)
    json.dump(app_files, open(app_json_output_file, "w"))

    print(
        f"""
Run:
    python3 -m http.server --directory {dest_dir} 8000
    """
    )


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Statically deploy a Shiny app.")
    parser.add_argument(
        "app_path",
        type=str,
        help="The path to the app directory containing the app.json file.",
    )
    parser.add_argument(
        "dest_dir",
        type=str,
        help="The path to the directory to which the app should be deployed.",
    )
    args = parser.parse_args()

    deploy(args.app_path, args.dest_dir)
