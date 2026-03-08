import type { PermissionRequest } from "../types";

interface Props {
  request: PermissionRequest;
  onRespond: (
    requestId: string,
    approved: boolean,
    updatedPermissions?: unknown[],
  ) => void;
}

function formatInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

export function PermissionDialog({
  request,
  onRespond,
}: Props): React.ReactElement {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#1a1a1a] border border-[#333] rounded-2xl p-6 max-w-lg w-full mx-4 shadow-2xl">
        <h3 className="text-lg font-semibold text-gray-200 mb-1">
          Tool Permission Request
        </h3>
        <p className="text-sm text-gray-400 mb-4">
          The assistant wants to use the following tool:
        </p>

        <div className="bg-[#111] border border-[#2a2a2a] rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-mono bg-blue-600/20 text-blue-400 px-2 py-1 rounded">
              {request.toolName}
            </span>
          </div>
          {request.decisionReason && (
            <p className="text-xs text-gray-500 mb-2">
              {request.decisionReason}
            </p>
          )}
          <pre className="text-xs text-gray-400 font-mono overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap">
            {formatInput(request.input)}
          </pre>
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={() => onRespond(request.requestId, false)}
            className="px-4 py-2 text-sm rounded-lg bg-[#2a2a2a] hover:bg-[#333] text-gray-300 transition-colors"
          >
            Deny
          </button>
          {request.suggestions && request.suggestions.length > 0 && (
            <button
              onClick={() =>
                onRespond(request.requestId, true, request.suggestions)
              }
              className="px-4 py-2 text-sm rounded-lg bg-[#2a2a2a] hover:bg-[#444] text-green-400 border border-green-600/30 transition-colors"
            >
              Always Allow
            </button>
          )}
          <button
            onClick={() => onRespond(request.requestId, true)}
            className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
