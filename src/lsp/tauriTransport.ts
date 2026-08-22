import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AbstractMessageReader,
  AbstractMessageWriter,
  type DataCallback,
  type Disposable,
  type Message,
} from "vscode-jsonrpc";

export class TauriMessageReader extends AbstractMessageReader {
  constructor(private language: string) {
    super();
  }

  listen(callback: DataCallback): Disposable {
    const unlistenPromise = listen<{ language: string; payload: string }>(
      "lsp-message",
      (event) => {
        if (event.payload.language === this.language) {
          const msg = JSON.parse(event.payload.payload) as Message;
          callback(msg);
        }
      },
    );
    return {
      dispose: () => {
        unlistenPromise.then((unlisten) => unlisten());
      },
    };
  }
}

export class TauriMessageWriter extends AbstractMessageWriter {
  constructor(private language: string) {
    super();
  }

  async write(msg: Message): Promise<void> {
    try {
      await invoke("lsp_send", {
        language: this.language,
        payload: JSON.stringify(msg),
      });
    } catch (e) {
      this.fireError(e);
    }
  }

  end(): void {}
}
