import { describe, it, expect } from "vitest";
import { tokenizeBash } from "./bash";
import type { Token } from "../../types.js";

function t(...values: string[]): Token[] {
  return values.map((v) => {
    if (v === "|") return { type: "operator", value: v };
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(v)) return { type: "env", value: v };
    return { type: "word", value: v };
  });
}

function s(segments: string[][]): Token[][] {
  return segments.map((seg) => t(...seg));
}

describe("tokenizeBash", () => {
  it("returns empty for empty and whitespace", () => {
    expect(tokenizeBash("")).toEqual([]);
    expect(tokenizeBash("   ")).toEqual([]);
  });

  describe("simple commands", () => {
    it("tokenizes a simple command", () => {
      const result = tokenizeBash("ls -la");
      expect(result).toEqual(s([["ls", "-la"]]));
      expect(result[0][0]).toMatchObject({ type: "word", value: "ls" });
      expect(result[0][1]).toMatchObject({ type: "word", value: "-la" });
    });

    it("tokenizes a command with arguments", () => {
      expect(tokenizeBash("rm -rf /tmp")).toEqual(s([["rm", "-rf", "/tmp"]]));
    });
  });

  describe("environment variable assignments", () => {
    it("strips env var prefix before command", () => {
      expect(tokenizeBash("FOO=bar npm install")).toEqual(s([["npm", "install"]]));
    });

    it("strips multiple env var assignments", () => {
      expect(tokenizeBash("FOO=bar BAR=baz npm install")).toEqual(s([["npm", "install"]]));
    });

    it("keeps env vars after the command", () => {
      expect(tokenizeBash("npm FOO=bar install")).toEqual(s([["npm", "FOO=bar", "install"]]));
    });
  });

  describe("command wrappers", () => {
    it("strips env wrapper", () => {
      expect(tokenizeBash("env npm install")).toEqual(s([["npm", "install"]]));
    });

    it("strips command wrapper", () => {
      expect(tokenizeBash("command npm install")).toEqual(s([["npm", "install"]]));
    });

    it("strips exec wrapper", () => {
      expect(tokenizeBash("exec npm install")).toEqual(s([["npm", "install"]]));
    });

    it("strips nohup wrapper", () => {
      expect(tokenizeBash("nohup npm install")).toEqual(s([["npm", "install"]]));
    });

    it("strips nice wrapper", () => {
      expect(tokenizeBash("nice npm install")).toEqual(s([["npm", "install"]]));
    });

    it("strips time wrapper", () => {
      expect(tokenizeBash("time npm install")).toEqual(s([["npm", "install"]]));
    });

    it("strips combined env var and wrapper", () => {
      expect(tokenizeBash("FOO=bar env npm install")).toEqual(s([["npm", "install"]]));
    });

    it("strips combined env var and exec wrapper", () => {
      expect(tokenizeBash("FOO=bar exec npm install")).toEqual(s([["npm", "install"]]));
    });
  });

  describe("pipeline and logical operators", () => {
    it("splits on &&", () => {
      expect(tokenizeBash("cd /tmp && npm install")).toEqual(s([["cd", "/tmp"], ["npm", "install"]]));
    });

    it("splits on ||", () => {
      expect(tokenizeBash("fail || succeed")).toEqual(s([["fail"], ["succeed"]]));
    });

    it("splits on ;", () => {
      expect(tokenizeBash("ls; cd /tmp")).toEqual(s([["ls"], ["cd", "/tmp"]]));
    });

    it("splits on multiple operators", () => {
      expect(tokenizeBash("a && b || c; d")).toEqual(s([["a"], ["b"], ["c"], ["d"]]));
    });
  });

  describe("pipe operator", () => {
    it("keeps pipe as part of the segment", () => {
      expect(tokenizeBash("cat file.txt | grep pattern")).toEqual(s([["cat", "file.txt", "|", "grep", "pattern"]]));
    });

    it("handles double pipe", () => {
      expect(tokenizeBash("a || b")).toEqual(s([["a"], ["b"]]));
    });
  });

  describe("quoting", () => {
    it("handles double-quoted strings", () => {
      expect(tokenizeBash('echo "hello world"')).toEqual(s([["echo", "hello world"]]));
    });

    it("handles single-quoted strings", () => {
      expect(tokenizeBash("echo 'hello world'")).toEqual(s([["echo", "hello world"]]));
    });

    it("handles variable references in double quotes (shell-quote strips unknown vars)", () => {
      expect(tokenizeBash('echo "$HOME/file.txt"')).toEqual(s([["echo", "/file.txt"]]));
    });
  });

  describe("complete pipelines", () => {
    it("tokenizes a full pipeline", () => {
      expect(tokenizeBash("cat /etc/passwd | grep root | wc -l")).toEqual(s([["cat", "/etc/passwd", "|", "grep", "root", "|", "wc", "-l"]]));
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Guardrail-relevant commands
  // ────────────────────────────────────────────────────────────────────────────

  describe("guardrail: rm commands", () => {
    it("tokenizes rm with file", () => {
      expect(tokenizeBash("rm foo.txt")).toEqual(s([["rm", "foo.txt"]]));
    });

    it("tokenizes rm -rf", () => {
      expect(tokenizeBash("rm -rf /tmp/data")).toEqual(s([["rm", "-rf", "/tmp/data"]]));
    });
  });

  describe("guardrail: bun global installs", () => {
    it("tokenizes bun add -g", () => {
      expect(tokenizeBash("bun add -g lodash")).toEqual(s([["bun", "add", "-g", "lodash"]]));
    });

    it("tokenizes bun install -g", () => {
      expect(tokenizeBash("bun install -g typescript")).toEqual(s([["bun", "install", "-g", "typescript"]]));
    });

    it("tokenizes bunx -g", () => {
      expect(tokenizeBash("bunx -g eslint")).toEqual(s([["bunx", "-g", "eslint"]]));
    });
  });

  describe("guardrail: npm/npx forbidden", () => {
    it("tokenizes npm install", () => {
      expect(tokenizeBash("npm install")).toEqual(s([["npm", "install"]]));
    });

    it("tokenizes npx eslint", () => {
      expect(tokenizeBash("npx eslint")).toEqual(s([["npx", "eslint"]]));
    });
  });

  describe("guardrail: nix commands", () => {
    it("tokenizes nix search", () => {
      expect(tokenizeBash("nix search")).toEqual(s([["nix", "search"]]));
    });

    it("tokenizes nix-hash", () => {
      expect(tokenizeBash("nix-hash url")).toEqual(s([["nix-hash", "url"]]));
    });

    it("tokenizes nix-prefetch-url", () => {
      expect(tokenizeBash("nix-prefetch-url url")).toEqual(s([["nix-prefetch-url", "url"]]));
    });

    it("tokenizes nix profile install", () => {
      expect(tokenizeBash("nix profile install nixpkgs#foo")).toEqual(s([["nix", "profile", "install", "nixpkgs#foo"]]));
    });

    it("tokenizes nix-collect-garbage", () => {
      expect(tokenizeBash("nix-collect-garbage")).toEqual(s([["nix-collect-garbage"]]));
    });
  });

  describe("guardrail: find from root", () => {
    it("tokenizes find /", () => {
      expect(tokenizeBash("find / -name '*.ts'")).toEqual(s([["find", "/", "-name", "*.ts"]]));
    });

    it("tokenizes find ~/", () => {
      expect(tokenizeBash("find ~/ -name '*.ts'")).toEqual(s([["find", "~/", "-name", "*.ts"]]));
    });

    it("tokenizes find /home/", () => {
      expect(tokenizeBash("find /home/ -name '*.ts'")).toEqual(s([["find", "/home/", "-name", "*.ts"]]));
    });
  });

  describe("guardrail: grep from root", () => {
    it("tokenizes grep -r /", () => {
      expect(tokenizeBash("grep -r pattern /")).toEqual(s([["grep", "-r", "pattern", "/"]]));
    });
  });

  describe("guardrail: interactive commands", () => {
    it("tokenizes bun run dev", () => {
      expect(tokenizeBash("bun run dev")).toEqual(s([["bun", "run", "dev"]]));
    });

    it("tokenizes vitest", () => {
      expect(tokenizeBash("vitest")).toEqual(s([["vitest"]]));
    });

    it("tokenizes tsc --watch", () => {
      expect(tokenizeBash("tsc --watch")).toEqual(s([["tsc", "--watch"]]));
    });
  });

  describe("guardrail: jj commands", () => {
    it("tokenizes jj log -l", () => {
      expect(tokenizeBash("jj log -l")).toEqual(s([["jj", "log", "-l"]]));
    });

    it("tokenizes jj status --json", () => {
      expect(tokenizeBash("jj status --json")).toEqual(s([["jj", "status", "--json"]]));
    });

    it("tokenizes jj diff --stat", () => {
      expect(tokenizeBash("jj diff --stat")).toEqual(s([["jj", "diff", "--stat"]]));
    });
  });

  describe("guardrail: git-to-jj mappings", () => {
    it("tokenizes git add", () => {
      expect(tokenizeBash("git add file.ts")).toEqual(s([["git", "add", "file.ts"]]));
    });

    it("tokenizes git commit", () => {
      expect(tokenizeBash("git commit -m 'message'")).toEqual(s([["git", "commit", "-m", "message"]]));
    });
  });

  describe("guardrail: curl to GitHub", () => {
    it("tokenizes curl https://api.github.com", () => {
      expect(tokenizeBash("curl https://api.github.com/repos")).toEqual(s([["curl", "https://api.github.com/repos"]]));
    });

    it("tokenizes git clone https://github.com", () => {
      expect(tokenizeBash("git clone https://github.com/user/repo")).toEqual(s([["git", "clone", "https://github.com/user/repo"]]));
    });
  });

  describe("guardrail: systemctl/apt/ldconfig", () => {
    it("tokenizes systemctl start", () => {
      expect(tokenizeBash("systemctl start foo")).toEqual(s([["systemctl", "start", "foo"]]));
    });

    it("tokenizes apt-get install", () => {
      expect(tokenizeBash("apt-get install vim")).toEqual(s([["apt-get", "install", "vim"]]));
    });
  });

  describe("guardrail: docker", () => {
    it("tokenizes docker ps", () => {
      expect(tokenizeBash("docker ps")).toEqual(s([["docker", "ps"]]));
    });

    it("tokenizes docker-compose up", () => {
      expect(tokenizeBash("docker-compose up")).toEqual(s([["docker-compose", "up"]]));
    });
  });

  describe("guardrail: sed/awk", () => {
    it("tokenizes sed", () => {
      expect(tokenizeBash("sed -i 's/foo/bar/' file.txt")).toEqual(s([["sed", "-i", "s/foo/bar/", "file.txt"]]));
    });

    it("tokenizes awk", () => {
      expect(tokenizeBash("awk '{print $1}' file.txt")).toEqual(s([["awk", "{print $1}", "file.txt"]]));
    });
  });

  describe("guardrail: uv commands", () => {
    it("tokenizes uv pip uninstall -y", () => {
      expect(tokenizeBash("uv pip uninstall -y package")).toEqual(s([["uv", "pip", "uninstall", "-y", "package"]]));
    });
  });

  describe("guardrail: python/pip forbidden", () => {
    it("tokenizes python script.py", () => {
      expect(tokenizeBash("python script.py")).toEqual(s([["python", "script.py"]]));
    });

    it("tokenizes pip install", () => {
      expect(tokenizeBash("pip install requests")).toEqual(s([["pip", "install", "requests"]]));
    });
  });

  describe("guardrail: permission-gate commands", () => {
    it("tokenizes sudo", () => {
      expect(tokenizeBash("sudo ls")).toEqual(s([["sudo", "ls"]]));
    });

    it("tokenizes dd", () => {
      expect(tokenizeBash("dd if=/dev/zero of=/dev/sda")).toEqual(s([["dd", "if=/dev/zero", "of=/dev/sda"]]));
    });

    it("tokenizes chmod 777", () => {
      expect(tokenizeBash("chmod 777 /path")).toEqual(s([["chmod", "777", "/path"]]));
    });

    it("tokenizes chmod -R", () => {
      expect(tokenizeBash("chmod -R 755 /path")).toEqual(s([["chmod", "-R", "755", "/path"]]));
    });
  });

  describe("guardrail: brotab", () => {
    it("tokenizes brotab close", () => {
      expect(tokenizeBash("brotab close")).toEqual(s([["brotab", "close"]]));
    });
  });

  describe("guardrail: ast-grep flags", () => {
    it("tokenizes ast-grep run -p", () => {
      expect(tokenizeBash("ast-grep run -p 'pattern'")).toEqual(s([["ast-grep", "run", "-p", "pattern"]]));
    });

    it("tokenizes ast-grep scan -p", () => {
      expect(tokenizeBash("ast-grep scan -p 'pattern'")).toEqual(s([["ast-grep", "scan", "-p", "pattern"]]));
    });
  });

  describe("guardrail: no-pi-tools-in-bash", () => {
    it("tokenizes web-search", () => {
      expect(tokenizeBash("web-search query")).toEqual(s([["web-search", "query"]]));
    });

    it("tokenizes duckdb-repl", () => {
      expect(tokenizeBash("duckdb-repl")).toEqual(s([["duckdb-repl"]]));
    });
  });

  describe("guardrail: no-recursive-sed-replace", () => {
    it("tokenizes find -exec sed -i", () => {
      expect(tokenizeBash("find . -name '*.ts' -exec sed -i 's/foo/bar/' {} +")).toEqual(s([["find", ".", "-name", "*.ts", "-exec", "sed", "-i", "s/foo/bar/", "{}", "+"]]));
    });

    it("tokenizes grep -rl | xargs sed -i", () => {
      expect(tokenizeBash("grep -rl 'foo' . | xargs sed -i 's/foo/bar/'")).toEqual(s([["grep", "-rl", "foo", ".", "|", "xargs", "sed", "-i", "s/foo/bar/"]]));
    });
  });

  describe("guardrail: nu-duckdb-tools", () => {
    it("tokenizes nu-repl", () => {
      expect(tokenizeBash("nu-repl")).toEqual(s([["nu-repl"]]));
    });

    it("tokenizes duckdb-repl", () => {
      expect(tokenizeBash("duckdb-repl")).toEqual(s([["duckdb-repl"]]));
    });
  });

  describe("guardrail: cm-flags", () => {
    it("tokenizes cm --version", () => {
      expect(tokenizeBash("cm --version")).toEqual(s([["cm", "--version"]]));
    });

    it("tokenizes cm deps --circular foo", () => {
      expect(tokenizeBash("cm deps --circular foo")).toEqual(s([["cm", "deps", "--circular", "foo"]]));
    });

    it("tokenizes cm callers symbol foo", () => {
      expect(tokenizeBash("cm callers symbol foo")).toEqual(s([["cm", "callers", "symbol", "foo"]]));
    });

    it("tokenizes cm map /path", () => {
      expect(tokenizeBash("cm map /path")).toEqual(s([["cm", "map", "/path"]]));
    });
  });

  describe("guardrail: jj-hunk-flags", () => {
    it("tokenizes jj-hunk --version", () => {
      expect(tokenizeBash("jj-hunk --version")).toEqual(s([["jj-hunk", "--version"]]));
    });

    it("tokenizes jj-hunk -V", () => {
      expect(tokenizeBash("jj-hunk -V")).toEqual(s([["jj-hunk", "-V"]]));
    });

    it("tokenizes jj-hunk split --include foo", () => {
      expect(tokenizeBash("jj-hunk split --include foo")).toEqual(s([["jj-hunk", "split", "--include", "foo"]]));
    });
  });

  describe("guardrail: kuva-flags", () => {
    it("tokenizes kuva scatter --x-col price", () => {
      expect(tokenizeBash("kuva scatter --x-col price")).toEqual(s([["kuva", "scatter", "--x-col", "price"]]));
    });

    it("tokenizes kuva --x-col price --y score", () => {
      expect(tokenizeBash("kuva --x-col price --y score")).toEqual(s([["kuva", "--x-col", "price", "--y", "score"]]));
    });

    it("tokenizes kuva bar --color red", () => {
      expect(tokenizeBash('kuva bar --color "red"')).toEqual(s([["kuva", "bar", "--color", "red"]]));
    });

    it("tokenizes kuva --y-col name", () => {
      expect(tokenizeBash("kuva --y-col name")).toEqual(s([["kuva", "--y-col", "name"]]));
    });

    it("tokenizes kuva --label-col label", () => {
      expect(tokenizeBash("kuva --label-col label")).toEqual(s([["kuva", "--label-col", "label"]]));
    });

    it("tokenizes kuva --color-by col", () => {
      expect(tokenizeBash("kuva --color-by col")).toEqual(s([["kuva", "--color-by", "col"]]));
    });

    it("tokenizes kuva --legend", () => {
      expect(tokenizeBash("kuva --legend")).toEqual(s([["kuva", "--legend"]]));
    });

    it("tokenizes kuva --agg avg", () => {
      expect(tokenizeBash("kuva --agg avg")).toEqual(s([["kuva", "--agg", "avg"]]));
    });

    it("tokenizes kuva --rotate-labels", () => {
      expect(tokenizeBash("kuva --rotate-labels")).toEqual(s([["kuva", "--rotate-labels"]]));
    });

    it("tokenizes kuva --size-col size", () => {
      expect(tokenizeBash("kuva --size-col size")).toEqual(s([["kuva", "--size-col", "size"]]));
    });

    it("tokenizes kuva --color-col color", () => {
      expect(tokenizeBash("kuva --color-col color")).toEqual(s([["kuva", "--color-col", "color"]]));
    });

    it("tokenizes kuva --value-col value", () => {
      expect(tokenizeBash("kuva --value-col value")).toEqual(s([["kuva", "--value-col", "value"]]));
    });

    it("tokenizes kuva --group-col group", () => {
      expect(tokenizeBash("kuva --group-col group")).toEqual(s([["kuva", "--group-col", "group"]]));
    });
  });

  describe("guardrail: nh-flags", () => {
    it("tokenizes nh build", () => {
      expect(tokenizeBash("nh build")).toEqual(s([["nh", "build"]]));
    });

    it("tokenizes nh home switch", () => {
      expect(tokenizeBash("nh home switch")).toEqual(s([["nh", "home", "switch"]]));
    });
  });

  describe("guardrail: vitest", () => {
    it("tokenizes bun test", () => {
      expect(tokenizeBash("bun test")).toEqual(s([["bun", "test"]]));
    });
  });
});
