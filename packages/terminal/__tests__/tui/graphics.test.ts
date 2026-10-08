import { clearImages, detectImageProtocol, drawImage, fitImage, pngSize, type CellRect } from "../../src/tui/graphics";

// The first 24 bytes of a PNG: signature, IHDR chunk length, "IHDR", width and height (big-endian).
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("detectImageProtocol", () => {
  it("picks kitty for kitty itself", () => {
    expect(detectImageProtocol({ TERM: "xterm-kitty" })).toBe("kitty");
    expect(detectImageProtocol({ TERM: "xterm-256color", KITTY_WINDOW_ID: "3" })).toBe("kitty");
  });

  it("picks kitty for Ghostty", () => {
    expect(detectImageProtocol({ TERM_PROGRAM: "ghostty" })).toBe("kitty");
    expect(detectImageProtocol({ TERM: "xterm-ghostty" })).toBe("kitty");
  });

  it("picks the iTerm2 protocol for iTerm2 and WezTerm", () => {
    expect(detectImageProtocol({ TERM_PROGRAM: "iTerm.app" })).toBe("iterm");
    expect(detectImageProtocol({ LC_TERMINAL: "iTerm2" })).toBe("iterm");
    expect(detectImageProtocol({ TERM_PROGRAM: "WezTerm" })).toBe("iterm");
  });

  it("returns none for terminals without image support", () => {
    expect(detectImageProtocol({})).toBe("none");
    expect(detectImageProtocol({ TERM: "xterm-256color" })).toBe("none");
    expect(detectImageProtocol({ TERM_PROGRAM: "Apple_Terminal" })).toBe("none");
    expect(detectImageProtocol({ TERM_PROGRAM: "vscode" })).toBe("none");
  });

  it("returns none inside tmux even in a kitty or iTerm2 terminal", () => {
    expect(detectImageProtocol({ TMUX: "/tmp/tmux-1000/default,1,0", TERM: "xterm-kitty" })).toBe("none");
    expect(detectImageProtocol({ TMUX: "/tmp/tmux-1000/default,1,0", TERM_PROGRAM: "iTerm.app" })).toBe("none");
    expect(detectImageProtocol({ TMUX: "x", KITTY_WINDOW_ID: "1" })).toBe("none");
  });

  it("returns none inside GNU screen", () => {
    expect(detectImageProtocol({ TERM: "screen-256color", KITTY_WINDOW_ID: "1" })).toBe("none");
    expect(detectImageProtocol({ TERM: "screen", TERM_PROGRAM: "WezTerm" })).toBe("none");
  });

  it("honors a forced protocol even inside tmux", () => {
    expect(detectImageProtocol({ TMUX: "x" }, "kitty")).toBe("kitty");
    expect(detectImageProtocol({ TMUX: "x" }, "iterm")).toBe("iterm");
    expect(detectImageProtocol({}, "kitty")).toBe("kitty");
  });

  it("honors a forced protocol that contradicts the environment", () => {
    expect(detectImageProtocol({ TERM: "xterm-kitty" }, "iterm")).toBe("iterm");
  });

  it("turns images off whatever the environment says", () => {
    expect(detectImageProtocol({ TERM: "xterm-kitty" }, "off")).toBe("none");
    expect(detectImageProtocol({ TERM_PROGRAM: "iTerm.app" }, "none")).toBe("none");
  });

  it("treats auto as detection and defaults to it", () => {
    expect(detectImageProtocol({ TERM: "xterm-kitty" }, "auto")).toBe("kitty");
    expect(detectImageProtocol({ TERM: "xterm-kitty" })).toBe("kitty");
  });

  it("falls back to detection for an unknown preference", () => {
    expect(detectImageProtocol({ TERM: "xterm-kitty" }, "sixel")).toBe("kitty");
    expect(detectImageProtocol({}, "sixel")).toBe("none");
  });
});

describe("pngSize", () => {
  it("reads the size from the IHDR chunk", () => {
    expect(pngSize(pngHeader(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it("reads sizes larger than 16 bits", () => {
    expect(pngSize(pngHeader(100_000, 70_000))).toEqual({ width: 100_000, height: 70_000 });
  });

  it("reads the size of a PNG held in a view into a larger buffer", () => {
    const big = new Uint8Array(100);
    big.set(pngHeader(1275, 1650), 7);
    expect(pngSize(big.subarray(7))).toEqual({ width: 1275, height: 1650 });
  });

  it("reads a real minimal PNG file", () => {
    const onePixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    );
    expect(pngSize(onePixel)).toEqual({ width: 1, height: 1 });
  });

  it("returns undefined for garbage", () => {
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeUndefined();
    expect(pngSize(Buffer.from("this is definitely not a PNG file, just some text"))).toBeUndefined();
    expect(pngSize(new Uint8Array(0))).toBeUndefined();
  });

  it("returns undefined for a PDF or JPEG header", () => {
    expect(pngSize(Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n"))).toBeUndefined();
    expect(pngSize(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array<number>(30).fill(0)]))).toBeUndefined();
  });

  it("returns undefined for a truncated PNG header", () => {
    expect(pngSize(pngHeader(10, 10).subarray(0, 23))).toBeUndefined();
    expect(pngSize(pngHeader(10, 10).subarray(0, 8))).toBeUndefined();
  });
});

describe("fitImage", () => {
  const box: CellRect = { x: 10, y: 2, cols: 40, rows: 20 };

  it("fills the width of the box for a landscape image", () => {
    expect(fitImage({ width: 1000, height: 500 }, box)).toEqual({ x: 10, y: 2, cols: 40, rows: 9 });
  });

  it("fills the height of the box for a portrait image and centers it horizontally", () => {
    const fitted = fitImage({ width: 500, height: 1000 }, box);
    expect(fitted).toEqual({ x: 19, y: 2, cols: 21, rows: 20 });
  });

  it("keeps the image's aspect ratio, within one cell of rounding", () => {
    for (const [width, height] of [[1275, 1650], [1650, 1275], [800, 800], [300, 1200], [1200, 300]] as const) {
      const fitted = fitImage({ width, height }, box, 2);
      const cellRatio = fitted.cols / (fitted.rows * 2);
      const imageRatio = width / height;
      // One cell of rounding in either dimension changes the ratio by at most this much.
      const tolerance = Math.max(1 / fitted.cols, 1 / fitted.rows) * imageRatio * 2;
      expect(Math.abs(cellRatio - imageRatio)).toBeLessThanOrEqual(tolerance);
    }
  });

  it("stays inside the box", () => {
    const images = [[1, 1], [100, 100], [5000, 10], [10, 5000], [1275, 1650], [1920, 1080]] as const;
    const boxes: CellRect[] = [box, { x: 0, y: 0, cols: 12, rows: 8 }, { x: 5, y: 5, cols: 200, rows: 3 }, { x: 3, y: 1, cols: 1, rows: 1 }];
    for (const [width, height] of images) {
      for (const target of boxes) {
        const fitted = fitImage({ width, height }, target);
        expect(fitted.cols).toBeGreaterThanOrEqual(1);
        expect(fitted.rows).toBeGreaterThanOrEqual(1);
        expect(fitted.cols).toBeLessThanOrEqual(target.cols);
        expect(fitted.rows).toBeLessThanOrEqual(target.rows);
        expect(fitted.x).toBeGreaterThanOrEqual(target.x);
        expect(fitted.x + fitted.cols).toBeLessThanOrEqual(target.x + target.cols);
        expect(fitted.y).toBe(target.y);
      }
    }
  });

  it("scales a small image up to the box", () => {
    const fitted = fitImage({ width: 10, height: 10 }, box, 2);
    expect(fitted.cols).toBeGreaterThan(10);
  });

  it("gives an extreme panorama at least one row", () => {
    const fitted = fitImage({ width: 10_000, height: 1 }, box);
    expect(fitted.rows).toBe(1);
    expect(fitted.cols).toBe(40);
  });

  it("uses the given cell aspect: square cells make a square image square", () => {
    expect(fitImage({ width: 100, height: 100 }, box, 1)).toEqual({ x: 20, y: 2, cols: 20, rows: 20 });
  });

  it("returns an empty rectangle for an empty box or image", () => {
    expect(fitImage({ width: 100, height: 100 }, { x: 4, y: 5, cols: 0, rows: 10 })).toEqual({ x: 4, y: 5, cols: 0, rows: 0 });
    expect(fitImage({ width: 100, height: 100 }, { x: 4, y: 5, cols: 10, rows: 0 })).toEqual({ x: 4, y: 5, cols: 0, rows: 0 });
    expect(fitImage({ width: 0, height: 100 }, box)).toEqual({ ...box, cols: 0, rows: 0 });
    expect(fitImage({ width: 100, height: 0 }, box)).toEqual({ ...box, cols: 0, rows: 0 });
  });
});

describe("drawImage", () => {
  const rect: CellRect = { x: 10, y: 2, cols: 20, rows: 8 };

  // Splits kitty output into its escape payloads: [control keys, base64 chunk].
  function kittyChunks(output: string): Array<[string, string]> {
    return [...output.matchAll(/\x1b_G([^;\x1b]*);([^\x1b]*)\x1b\\/g)].map((m) => [m[1]!, m[2]!]);
  }

  it("returns an empty string for protocol none", () => {
    expect(drawImage("none", new Uint8Array([1, 2, 3]), rect)).toBe("");
  });

  it("returns an empty string for an empty rectangle", () => {
    expect(drawImage("kitty", new Uint8Array([1]), { ...rect, cols: 0 })).toBe("");
    expect(drawImage("iterm", new Uint8Array([1]), { ...rect, rows: 0 })).toBe("");
  });

  describe("iterm", () => {
    const png = new Uint8Array([1, 2, 3, 4, 5]);

    it("moves the cursor to the rectangle and sends one OSC 1337 sequence with its cell size", () => {
      const output = drawImage("iterm", png, rect);
      expect(output.startsWith("\x1b[3;11H")).toBe(true);
      expect(output).toContain("\x1b]1337;File=inline=1;");
      expect(output).toContain("width=20;height=8");
      expect(output).toContain("size=5;");
      expect(output.endsWith("\x07")).toBe(true);
    });

    it("carries the whole image base64-encoded after the colon", () => {
      const output = drawImage("iterm", png, rect);
      const payload = output.slice(output.indexOf(":") + 1, -1);
      expect(Buffer.from(payload, "base64")).toEqual(Buffer.from(png));
    });

    it("keeps the aspect ratio inside the given cells", () => {
      expect(drawImage("iterm", png, rect)).toContain("preserveAspectRatio=1");
    });

    it("never splits a large image into several sequences", () => {
      const big = new Uint8Array(20_000).fill(7);
      const output = drawImage("iterm", big, rect);
      expect(output.match(/\x1b\]1337/g)).toHaveLength(1);
      expect(output.match(/\x07/g)).toHaveLength(1);
    });
  });

  describe("kitty", () => {
    it("sends a small image as a single chunk with m=0", () => {
      const output = drawImage("kitty", new Uint8Array([1, 2, 3, 4, 5]), rect);
      expect(output.startsWith("\x1b[3;11H")).toBe(true);
      const chunks = kittyChunks(output);
      expect(chunks).toHaveLength(1);
      const [control, data] = chunks[0]!;
      expect(control).toBe("a=T,f=100,t=d,i=1,p=1,c=20,r=8,C=1,q=2,m=0");
      expect(data).toBe(Buffer.from([1, 2, 3, 4, 5]).toString("base64"));
    });

    it("splits a large image into 4096-character chunks, marking all but the last with m=1", () => {
      const png = new Uint8Array(6000).map((_, i) => i % 251);
      const output = drawImage("kitty", png, rect);
      const chunks = kittyChunks(output);
      expect(chunks).toHaveLength(2);
      expect(chunks[0]![0]).toContain("m=1");
      expect(chunks[0]![0]).toContain("a=T");
      expect(chunks[0]![1]).toHaveLength(4096);
      expect(chunks[1]![0]).toBe("m=0,q=2");
      expect(chunks[1]![1]).toHaveLength(8000 - 4096);
    });

    it("carries the complete image across the chunks", () => {
      const png = new Uint8Array(10_000).map((_, i) => (i * 7) % 256);
      const chunks = kittyChunks(drawImage("kitty", png, rect));
      expect(chunks.length).toBeGreaterThan(2);
      const joined = chunks.map(([, data]) => data).join("");
      expect(Buffer.from(joined, "base64")).toEqual(Buffer.from(png));
      for (const [, data] of chunks) { expect(data.length).toBeLessThanOrEqual(4096); }
    });

    it("sets m=1 on every chunk except the last", () => {
      const chunks = kittyChunks(drawImage("kitty", new Uint8Array(12_000).fill(9), rect));
      const flags = chunks.map(([control]) => /(?:^|,)m=(\d)/.exec(control)![1]);
      expect(flags.slice(0, -1).every((flag) => flag === "1")).toBe(true);
      expect(flags[flags.length - 1]).toBe("0");
    });

    it("only puts the placement keys in the first chunk", () => {
      const chunks = kittyChunks(drawImage("kitty", new Uint8Array(6000).fill(1), rect));
      expect(chunks[0]![0]).toContain("c=20,r=8");
      expect(chunks[1]![0]).not.toContain("c=");
    });

    it("keeps an image of exactly one chunk in a single sequence", () => {
      // 3072 bytes encode to exactly 4096 base64 characters.
      expect(kittyChunks(drawImage("kitty", new Uint8Array(3072), rect))).toHaveLength(1);
      expect(kittyChunks(drawImage("kitty", new Uint8Array(3073), rect))).toHaveLength(2);
    });

    it("uses the given image id", () => {
      expect(drawImage("kitty", new Uint8Array([1]), rect, 7)).toContain("i=7,");
    });

    it("keeps the cursor in place and silences replies", () => {
      const control = kittyChunks(drawImage("kitty", new Uint8Array([1]), rect))[0]![0];
      expect(control).toContain("C=1");
      expect(control).toContain("q=2");
    });
  });
});

describe("clearImages", () => {
  it("deletes every kitty image", () => {
    expect(clearImages("kitty")).toBe("\x1b_Ga=d,d=A,q=2\x1b\\");
  });

  it("returns nothing for iTerm2, whose images are cell content, and for none", () => {
    expect(clearImages("iterm")).toBe("");
    expect(clearImages("none")).toBe("");
  });
});
