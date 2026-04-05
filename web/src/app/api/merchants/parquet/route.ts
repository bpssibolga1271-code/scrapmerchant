import { NextResponse } from 'next/server';
import fs from 'fs/promises';

import { getParquetFilePath, parquetFileExists } from '@/lib/parquet';

export async function GET() {
  try {
    if (!parquetFileExists()) {
      return NextResponse.json(
        { error: 'No data available' },
        { status: 404 },
      );
    }

    const filePath = getParquetFilePath();
    const buffer = await fs.readFile(filePath);

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="merchants.parquet"',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    console.error('Error serving parquet file:', error);
    return NextResponse.json(
      { error: 'Failed to serve parquet file' },
      { status: 500 },
    );
  }
}
