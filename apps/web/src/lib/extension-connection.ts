export interface ExtensionConnectionInput {
  apiBaseUrl: string;
  token: string;
}

export interface ExtensionEndpointSaveMessage {
  type: 'ozon-calc:erp-endpoint-save';
  payload: {
    endpoint: string;
    token: string;
  };
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

export function buildExtensionCollectEndpoint(apiBaseUrl: string): string {
  return `${trimTrailingSlash(apiBaseUrl.trim())}/api/collect`;
}

export function buildExtensionConnectionMessage(input: ExtensionConnectionInput): ExtensionEndpointSaveMessage {
  return {
    type: 'ozon-calc:erp-endpoint-save',
    payload: {
      endpoint: buildExtensionCollectEndpoint(input.apiBaseUrl),
      token: input.token.trim(),
    },
  };
}
