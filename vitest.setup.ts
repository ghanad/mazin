// Runtime configuration used by every test. Real credentials are never
// required — the S3 client is either faked or never dialed.
process.env.S3_ENDPOINT = "https://s3.test.internal";
process.env.S3_REGION = "default";
process.env.S3_ACCESS_KEY = "test-access-key";
process.env.S3_SECRET_KEY = "test-secret-key";
process.env.S3_BUCKET = "test-bucket";
process.env.S3_FORCE_PATH_STYLE = "true";
process.env.APP_BASE_URL = "https://files.internal.example.com";
process.env.UPLOAD_PART_SIZE_MB = "64";
process.env.PRESIGN_EXPIRY_SECONDS = "3600";
