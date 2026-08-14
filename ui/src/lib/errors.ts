// Maps send failures to the program's error names so toasts read
// "DepositWindowClosed", not a wall of logs.
import { RelaunchIDL } from "@metadaoproject/programs";

const ANCHOR_LOG =
  /Error Code: (\w+)\. Error Number: (\d+)\. Error Message: (.*?)\.?$/;
const CUSTOM_ERROR = /custom program error: (0x[0-9a-fA-F]+)/;

export function explainError(error: unknown): { title: string; detail: string } {
  const message = error instanceof Error ? error.message : String(error);
  const logs: string[] = (error as any)?.logs ?? [];

  if (/user rejected|rejected the request|declined/i.test(message)) {
    return { title: "Signature declined", detail: "The wallet rejected the transaction." };
  }

  for (const log of logs) {
    const match = log.match(ANCHOR_LOG);
    if (match) return { title: match[1], detail: match[3] };
  }

  const custom = (logs.join("\n") + "\n" + message).match(CUSTOM_ERROR);
  if (custom) {
    const code = parseInt(custom[1], 16);
    const idlError = RelaunchIDL.errors?.find((e) => e.code === code);
    if (idlError) {
      return { title: idlError.name, detail: idlError.msg ?? "" };
    }
    return { title: `Program error ${custom[1]}`, detail: message };
  }

  return {
    title: "Transaction failed",
    detail: message.length > 220 ? `${message.slice(0, 220)}…` : message,
  };
}
