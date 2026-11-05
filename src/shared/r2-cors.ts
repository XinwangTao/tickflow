export const R2_CORS_POLICY = JSON.stringify(
  [
    {
      AllowedOrigins: ['https://localhost', 'http://localhost', 'capacitor://localhost'],
      AllowedMethods: ['GET', 'PUT', 'HEAD'],
      AllowedHeaders: ['*'],
      ExposeHeaders: ['ETag'],
      MaxAgeSeconds: 3600
    }
  ],
  null,
  2
)
