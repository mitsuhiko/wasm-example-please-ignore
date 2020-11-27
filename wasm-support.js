(function () {
  const IMAGES = [];
  const origInstantiateStreaming = WebAssembly.instantiateStreaming;
  const origCompileStreaming = WebAssembly.compileStreaming;

  function getModuleInfo(module) {
    const buildIds = WebAssembly.Module.customSections(module, "build_id");
    let buildId = null;
    let debugFile = null;

    if (buildIds.length > 0) {
      const firstBuildId = new Uint8Array(buildIds[0]);
      buildId = Array.from(firstBuildId).reduce((acc, x, idx) => {
        return acc + (x & 0xff).toString(16).padStart(2, "0");
      }, "");
    }

    const externalDebugInfo = WebAssembly.Module.customSections(
      module,
      "external_debug_info"
    );
    if (externalDebugInfo.length > 0) {
      const firstExternalDebugInfo = new Uint8Array(externalDebugInfo[0]);
      const decoder = new TextDecoder("utf-8");
      debugFile = decoder.decode(firstExternalDebugInfo);
    }

    return { buildId, debugFile };
  }

  function recordModule(module, url) {
    const { buildId, debugFile } = getModuleInfo(module);
    if (buildId || debugFile) {
      const oldIdx = IMAGES.findIndex((img) => img.code_file === url);
      if (oldIdx >= 0) {
        IMAGES.splice(oldIdx, 1);
      }
      IMAGES.push({
        type: "wasm",
        code_id: buildId,
        code_file: url,
        debug_file: debugFile,
        debug_id: buildId.padEnd(32, "0").substr(0, 32) + "0",
      });
    }
  }

  function recordedInstanticateStreaming(promise, obj) {
    return Promise.resolve(promise).then((resp) => {
      return origInstantiateStreaming(resp, obj).then((rv) => {
        if (resp.url) {
          recordModule(rv.module, resp.url);
        }
        return rv;
      });
    });
  }

  function recordedCompileStreaming(promise, obj) {
    return Promise.resolve(promise).then((resp) => {
      return origCompileStreaming(resp, obj).then((module) => {
        if (resp.url) {
          recordModule(module, resp.url);
        }
        return module;
      });
    });
  }

  function getDebugMeta() {
    return {
      images: IMAGES,
    };
  }

  function getImageIndex(url) {
    return IMAGES.findIndex((img) => img.code_file === url);
  }

  Sentry.addGlobalEventProcessor((event) => {
    let haveWasm = false;
    console.log(JSON.stringify(event, null, 2));
    if (event.exception && event.exception.values) {
      event.exception.values.forEach((exception) => {
        if (!exception.stacktrace) {
          return;
        }
        exception.stacktrace.frames.forEach((frame) => {
          let match;
          if (
            frame.filename &&
            (match = frame.filename.match(
              /^(.*?):wasm-function\[\d+\]:(0x[a-fA-F0-9]+)$/
            ))
          ) {
            const index = getImageIndex(match[1]);
            if (index >= 0) {
              frame.instruction_addr = match[2];
              frame.addr_mode = `rel:${index}`;
              frame.filename = match[1];
              frame.platform = "native";
              haveWasm = true;
            }
          }
        });
      });
    }

    if (haveWasm) {
      event.debug_meta = getDebugMeta();
    }

    return event;
  });

  WebAssembly.instantiateStreaming = recordedInstanticateStreaming;
  WebAssembly.compileStreaming = recordedCompileStreaming;
})();
