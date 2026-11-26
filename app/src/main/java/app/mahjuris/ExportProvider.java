package app.mahjuris;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

/** Entrega, só para leitura, os arquivos exportados em cache/export para o app escolhido no compartilhamento. */
public class ExportProvider extends ContentProvider {
    static final String AUTHORITY = "app.mahjuris.files";

    static File dir(android.content.Context c) { return new File(c.getCacheDir(), "export"); }

    File fileFor(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (name == null) throw new FileNotFoundException();
        try {
            File base = dir(getContext()).getCanonicalFile();
            File f = new File(base, name).getCanonicalFile();
            if (!base.equals(f.getParentFile()) || !f.isFile()) throw new FileNotFoundException();
            return f;
        } catch (IOException e) { throw new FileNotFoundException(); }
    }

    @Override public boolean onCreate() { return true; }

    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(fileFor(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override public String getType(Uri uri) {
        String n = String.valueOf(uri.getLastPathSegment()).toLowerCase();
        if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        if (n.endsWith(".csv")) return "text/csv";
        if (n.endsWith(".pdf")) return "application/pdf";
        return "application/octet-stream";
    }

    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        File f;
        try { f = fileFor(uri); } catch (FileNotFoundException e) { return null; }
        String[] cols = projection != null ? projection : new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE };
        MatrixCursor c = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
        }
        c.addRow(row);
        return c;
    }

    @Override public Uri insert(Uri uri, ContentValues values) { return null; }
    @Override public int delete(Uri uri, String sel, String[] args) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String sel, String[] args) { return 0; }
}
