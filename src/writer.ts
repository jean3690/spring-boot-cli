import { unzipSync, type Unzipped } from "fflate";
import { mkdir, chmod, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

/** Extract a starter.zip buffer into the target directory. */
export async function unzipToDir(zip: ArrayBuffer, targetDir: string): Promise<number> {
  const files: Unzipped = unzipSync(new Uint8Array(zip));
  const root = resolve(targetDir);

  const paths = Object.keys(files);
  for (const path of paths) {
    if (path.endsWith("/")) continue; // directory entries
    const parts = path.split("/");
    // Basic zip-slip protection: reject paths escaping the target dir.
    const dest = resolve(root, ...parts);
    if (dest !== root && !dest.startsWith(root + sep)) {
      throw new Error(`Illegal path in archive: ${path}`);
    }
    const data = files[path]!;
    await mkdir(dest.substring(0, dest.lastIndexOf(sep)), { recursive: true });
    await writeFile(dest, data);
  }

  // Make Maven/Gradle wrappers executable (zip modes are not preserved by fflate).
  for (const wrapper of ["mvnw", "gradlew"]) {
    try {
      await chmod(join(root, wrapper), 0o755);
    } catch {
      // wrapper not present in this project
    }
  }
  return paths.filter((p) => !p.endsWith("/")).length;
}
