export type AsteraEnvironment = 'local' | 'preview' | 'staging' | 'production';

export type PublicAppConfig = {
  environment: AsteraEnvironment;
  appOrigin: string;
  apiOrigin: string;
  catalogEndpoint: string;
  statusEndpoint: string;
  buildVersion: string;
  deterministicJapaneseMcpEnabled: boolean;
  deterministicJapaneseMcpSchemaVersion?: string;
};

export function validatePublicAppConfig(config: PublicAppConfig): string[] {
  const errors: string[] = [];
  const urls: Array<keyof Pick<PublicAppConfig, 'appOrigin' | 'apiOrigin' | 'catalogEndpoint' | 'statusEndpoint'>> = [
    'appOrigin',
    'apiOrigin',
    'catalogEndpoint',
    'statusEndpoint',
  ];
  for (const key of urls) {
    try {
      const url = new URL(config[key]);
      if (config.environment !== 'local' && url.protocol !== 'https:') errors.push(key);
    } catch {
      errors.push(key);
    }
  }
  if (!config.buildVersion) errors.push('buildVersion');
  if (config.deterministicJapaneseMcpEnabled && !config.deterministicJapaneseMcpSchemaVersion) {
    errors.push('deterministicJapaneseMcpSchemaVersion');
  }
  return [...new Set(errors)];
}
