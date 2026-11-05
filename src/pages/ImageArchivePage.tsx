import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, RefreshCw, FolderSearch, Image, X, Tag, CheckCircle, AlertCircle, Download, CheckSquare, Square, ChevronLeft, ChevronRight, Loader2, Bone as ZipIcon, FileJson } from 'lucide-react';
import JSZip from 'jszip';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface DropboxImage {
  id: string;
  dropbox_path: string;
  dropbox_shared_link: string | null;
  tags: string[];
  last_scanned_at: string;
  status: string;
}

const PAGE_SIZE = 50;
const FOLDER_PATHS: { path: string; label: string }[] = [
  { path: '/Test_Enea Group Objects/Test Metadata/General', label: 'General' },
  { path: '/US/03_Library/02_Mood', label: 'USA Mood' },
];

const TAG_SYNONYMS: string[][] = [
  ['grün', 'green', 'grüner', 'grüne'],
  ['blau', 'blue', 'blaue', 'blauer'],
  ['rot', 'red', 'rote', 'roter'],
  ['gelb', 'yellow', 'gelbe', 'gelber'],
  ['weiß', 'weiss', 'white', 'weiße'],
  ['schwarz', 'black', 'schwarze', 'schwarzer'],
  ['grau', 'grey', 'gray', 'graue', 'grauer'],
  ['braun', 'brown', 'braune', 'brauner'],
  ['orange', 'orangefarbig'],
  ['pink', 'rosa', 'pink', 'rose'],
  ['lila', 'purple', 'violet', 'violett'],
  ['beige', 'creme', 'cream'],
  ['baum', 'tree', 'bäume', 'trees'],
  ['pflanze', 'plant', 'pflanzen', 'plants'],
  ['blume', 'flower', 'blumen', 'flowers'],
  ['gras', 'grass', 'rasen', 'lawn'],
  ['strauch', 'shrub', 'sträucher', 'shrubs', 'busch', 'bush'],
  ['stein', 'stone', 'steine', 'stones', 'fels', 'rock'],
  ['holz', 'wood', 'wooden'],
  ['wasser', 'water'],
  ['licht', 'light', 'hell', 'bright'],
  ['dunkel', 'dark', 'düster'],
  ['modern', 'zeitgemäß', 'contemporary'],
  ['natürlich', 'natural', 'natur', 'nature'],
  ['minimalistisch', 'minimalist', 'minimal'],
  ['tropisch', 'tropical'],
  ['mediterran', 'mediterranean'],
  ['frühling', 'spring'],
  ['sommer', 'summer'],
  ['herbst', 'autumn', 'fall'],
  ['winter'],
  ['textur', 'texture', 'texturiert', 'textured'],
  ['garten', 'garden'],
  ['stadtgarten', 'urban garden', 'urban'],
  ['terrasse', 'terrace', 'patio'],
  ['weg', 'path', 'pfad', 'walkway'],
];

function expandSearchTerms(term: string): string[] {
  const normalized = term.toLowerCase().trim();
  for (const group of TAG_SYNONYMS) {
    if (group.some((s) => s === normalized)) return group;
  }
  return [normalized];
}

// ── Download helpers ──────────────────────────────────────────────────────────

const proxyUrl = (imageUrl: string): string => {
  const base = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/proxy-image-download`;
  return `${base}?url=${encodeURIComponent(imageUrl)}`;
};

const fetchImageBlob = async (url: string): Promise<Blob> => {
  const res = await fetch(proxyUrl(url), {
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
};

const downloadSingle = async (image: DropboxImage): Promise<void> => {
  if (!image.dropbox_shared_link) return;
  const blob = await fetchImageBlob(image.dropbox_shared_link);
  const fileName = image.dropbox_path.split('/').pop() ?? 'image';
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(objectUrl);
};

const downloadZip = async (
  images: DropboxImage[],
  onProgress: (n: number, total: number) => void
): Promise<void> => {
  const zip = new JSZip();
  const usedNames = new Map<string, number>();

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    onProgress(i, images.length);
    if (!img.dropbox_shared_link) continue;
    try {
      const blob = await fetchImageBlob(img.dropbox_shared_link);
      let baseName = img.dropbox_path.split('/').pop() ?? `image_${i}`;
      const count = usedNames.get(baseName) ?? 0;
      usedNames.set(baseName, count + 1);
      if (count > 0) {
        const ext = baseName.includes('.') ? '.' + baseName.split('.').pop() : '';
        const stem = baseName.slice(0, baseName.length - ext.length);
        baseName = `${stem}_${count}${ext}`;
      }
      zip.file(baseName, blob);
    } catch { /* skip failed */ }
  }

  onProgress(images.length, images.length);
  const zipBlob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const objectUrl = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `enea_images_${new Date().toISOString().split('T')[0]}.zip`;
  a.click();
  URL.revokeObjectURL(objectUrl);
};

// ── Sub-components ─────────────────────────────────────────────────────────────

interface LightboxProps {
  images: DropboxImage[];
  index: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onDownload: (image: DropboxImage) => void;
  downloadingId: string | null;
}

const LightboxModal: React.FC<LightboxProps> = ({ images, index, onClose, onPrev, onNext, onDownload, downloadingId }) => {
  const image = images[index];
  const fileName = image.dropbox_path.split('/').pop() ?? image.dropbox_path;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') onPrev();
      if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, onPrev, onNext]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors z-10"
      >
        <X className="w-5 h-5" />
      </button>

      {/* Prev */}
      {images.length > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          className="absolute left-4 w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors z-10"
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      {/* Image container */}
      <div
        className="relative max-w-5xl max-h-[80vh] w-full mx-20 flex flex-col items-center gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {image.dropbox_shared_link ? (
          <img
            src={image.dropbox_shared_link.replace('dl=0', 'raw=1')}
            alt={fileName}
            className="max-h-[70vh] max-w-full object-contain rounded-lg shadow-2xl"
          />
        ) : (
          <div className="w-64 h-64 bg-white/10 rounded-lg flex items-center justify-center">
            <Image className="w-16 h-16 text-white/40" />
          </div>
        )}

        {/* Metadata bar */}
        <div className="w-full bg-white/10 backdrop-blur-md rounded-xl px-4 py-3 flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-white font-medium text-sm truncate mb-1">{fileName}</p>
            <div className="flex flex-wrap gap-1">
              {image.tags.slice(0, 12).map((tag) => (
                <span key={tag} className="px-1.5 py-0.5 bg-white/15 text-white/80 text-xs rounded-full">{tag}</span>
              ))}
              {image.tags.length > 12 && (
                <span className="px-1.5 py-0.5 bg-white/10 text-white/50 text-xs rounded-full">+{image.tags.length - 12}</span>
              )}
            </div>
          </div>
          {image.dropbox_shared_link && (
            <button
              onClick={() => onDownload(image)}
              disabled={downloadingId === image.id}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 bg-white/20 hover:bg-white/30 text-white text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              {downloadingId === image.id
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Download className="w-4 h-4" />}
              Download
            </button>
          )}
        </div>

        {/* Counter */}
        <p className="text-white/50 text-xs">{index + 1} / {images.length}</p>
      </div>

      {/* Next */}
      {images.length > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          className="absolute right-4 w-11 h-11 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors z-10"
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}
    </div>
  );
};

const SkeletonCard: React.FC = () => (
  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden animate-pulse">
    <div className="bg-gray-100 h-48 w-full" />
    <div className="p-3 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {[1, 2, 3].map((i) => <div key={i} className="h-4 w-14 bg-gray-100 rounded-full" />)}
      </div>
      <div className="h-3 w-3/4 bg-gray-100 rounded" />
    </div>
  </div>
);

interface ImageCardProps {
  image: DropboxImage;
  selected: boolean;
  onToggle: () => void;
  onPreview: () => void;
  onDownload: () => void;
  downloading: boolean;
}

const ImageCard: React.FC<ImageCardProps> = ({ image, selected, onToggle, onPreview, onDownload, downloading }) => {
  const [imgError, setImgError] = useState(false);
  const [showAllTags, setShowAllTags] = useState(false);
  const fileName = image.dropbox_path.split('/').pop() ?? image.dropbox_path;
  const visibleTags = showAllTags ? image.tags : image.tags.slice(0, 5);
  const hiddenCount = image.tags.length - 5;

  return (
    <div
      className={`bg-white rounded-xl border-2 overflow-hidden transition-all duration-200 group cursor-pointer
        ${selected ? 'border-cyan-500 shadow-md shadow-cyan-100' : 'border-gray-200 hover:border-cyan-300 hover:shadow-sm'}`}
      onClick={onPreview}
    >
      <div className="relative h-48 bg-gray-50 overflow-hidden">
        {image.dropbox_shared_link && !imgError ? (
          <img
            src={image.dropbox_shared_link.replace('dl=0', 'raw=1')}
            alt={fileName}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-300">
            <Image className="w-10 h-10" />
            <span className="text-xs text-gray-400">Preview unavailable</span>
          </div>
        )}

        <button
          onClick={(e) => { e.stopPropagation(); onToggle(); }}
          className={`absolute top-2 left-2 transition-opacity duration-150
            ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
        >
          <div className={`w-6 h-6 rounded-md flex items-center justify-center shadow-sm
            ${selected ? 'bg-cyan-500' : 'bg-white/90 border border-gray-300'}`}>
            {selected && <CheckCircle className="w-4 h-4 text-white" />}
          </div>
        </button>

        {image.dropbox_shared_link && (
          <button
            onClick={(e) => { e.stopPropagation(); onDownload(); }}
            disabled={downloading}
            className="absolute top-2 right-2 w-7 h-7 bg-white/90 hover:bg-white rounded-lg shadow-sm flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 disabled:opacity-50"
            title="Download"
          >
            {downloading
              ? <Loader2 className="w-3.5 h-3.5 text-gray-600 animate-spin" />
              : <Download className="w-3.5 h-3.5 text-gray-600" />}
          </button>
        )}
      </div>

      <div className="p-3">
        {image.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {visibleTags.map((tag) => (
              <span key={tag} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                {tag}
              </span>
            ))}
            {!showAllTags && hiddenCount > 0 && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowAllTags(true); }}
                className="px-1.5 py-0.5 bg-cyan-50 hover:bg-cyan-100 text-cyan-600 text-xs rounded-full transition-colors"
              >
                +{hiddenCount}
              </button>
            )}
            {showAllTags && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowAllTags(false); }}
                className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-400 text-xs rounded-full transition-colors"
              >
                less
              </button>
            )}
          </div>
        )}
        <p className="text-xs text-gray-400 truncate font-mono" title={image.dropbox_path}>
          {fileName}
        </p>
      </div>
    </div>
  );
};

// ── Scan progress types ───────────────────────────────────────────────────────

interface ScanProgress {
  phase: 'idle' | 'listing' | 'processing' | 'done' | 'error';
  total: number;
  processed: number;
  skipped: number;
  currentFile: string;
  errors: string[];
  message: string;
}

const initialProgress: ScanProgress = {
  phase: 'idle', total: 0, processed: 0, skipped: 0, currentFile: '', errors: [], message: '',
};

// ── Auth gate ─────────────────────────────────────────────────────────────────

interface AuthGateProps {
  onClose?: () => void;
}

const MicrosoftIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 23 23" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1 1h10v10H1z" fill="#F25022" />
    <path d="M12 1h10v10H12z" fill="#7FBA00" />
    <path d="M1 12h10v10H1z" fill="#00A4EF" />
    <path d="M12 12h10v10H12z" fill="#FFB900" />
  </svg>
);

const AuthGate: React.FC<AuthGateProps> = () => {
  const { signInWithMicrosoft } = useAuth();
  const [error, setError] = useState('');
  const [msLoading, setMsLoading] = useState(false);

  const handleMicrosoft = async () => {
    setError('');
    setMsLoading(true);
    const { error } = await signInWithMicrosoft();
    if (error) {
      setError(error.message);
      setMsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8 gap-1">
          <img src="/image copy copy.png" alt="enea" className="h-10 mx-auto" />
          <span className="text-xs tracking-[0.2em] text-gray-400 uppercase font-light">image search</span>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
          {/* Microsoft SSO */}
          <button
            onClick={handleMicrosoft}
            disabled={msLoading}
            className="w-full py-2.5 bg-white hover:bg-gray-50 border border-gray-300 disabled:opacity-60 text-gray-700 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2.5 mb-4"
          >
            {msLoading
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <MicrosoftIcon className="w-4 h-4" />}
            Sign in with Microsoft
          </button>

          <p className="text-sm text-gray-400 text-center mt-4">
            Sign in to search the image archive.
          </p>

          {error && (
            <div className="flex items-start gap-2 p-3 mt-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ── Page component ─────────────────────────────────────────────────────────────

export const ImageArchivePage: React.FC = () => {
  const { user, isAdmin, loading: authLoading, signOut } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [adminOpen, setAdminOpen] = useState(false);

  const [images, setImages] = useState<DropboxImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  const [selectedImages, setSelectedImages] = useState<Map<string, DropboxImage>>(new Map());

  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ n: number; total: number } | null>(null);

  const [progress, setProgress] = useState<ScanProgress>(initialProgress);
  const abortRef = useRef(false);

  // JSON import state
  const [jsonImporting, setJsonImporting] = useState(false);
  const [jsonImportProgress, setJsonImportProgress] = useState<{ n: number; total: number; errors: number } | null>(null);
  const [jsonImportResult, setJsonImportResult] = useState<{ inserted: number; errors: number } | null>(null);
  const jsonFileRef = useRef<HTMLInputElement>(null);

  // Shared link generation state
  const [linkGenRunning, setLinkGenRunning] = useState(false);
  const [linkGenProgress, setLinkGenProgress] = useState<{ created: number; remaining: number } | null>(null);
  const linkGenAbortRef = useRef(false);
  const [selectedFolder, setSelectedFolder] = useState<string>(FOLDER_PATHS[0].path);

  // Lightbox state
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const terms = searchQuery.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
      setDebouncedQuery(terms.join(','));
      setCurrentPage(1);
      setSelectedImages(new Map());
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const fetchImages = useCallback(async () => {
    setLoading(true);
    try {
      const rawTerms = debouncedQuery ? debouncedQuery.split(',').filter(Boolean) : [];
      const start = (currentPage - 1) * PAGE_SIZE;
      const end = start + PAGE_SIZE - 1;

      let query = supabase
        .from('dropbox_images_index')
        .select('*', { count: 'exact' })
        .order('dropbox_shared_link', { ascending: false, nullsFirst: false })
        .order('last_scanned_at', { ascending: false })
        .range(start, end);

      for (const term of rawTerms) {
        const expanded = expandSearchTerms(term);
        query = (query as any).overlaps('tags', expanded);
      }

      const { data, error, count } = await (query as any);
      if (error) throw error;

      setImages(data ?? []);
      setTotalCount(count ?? 0);
    } catch (err) {
      console.error('Failed to fetch images:', err);
      setImages([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [debouncedQuery, currentPage]);

  useEffect(() => { fetchImages(); }, [fetchImages]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const allPageSelected = images.length > 0 && images.every((img) => selectedImages.has(img.id));

  const toggleOne = (image: DropboxImage) => {
    setSelectedImages((prev) => {
      const next = new Map(prev);
      if (next.has(image.id)) next.delete(image.id); else next.set(image.id, image);
      return next;
    });
  };

  const togglePage = () => {
    setSelectedImages((prev) => {
      const next = new Map(prev);
      if (allPageSelected) { images.forEach((img) => next.delete(img.id)); }
      else { images.forEach((img) => next.set(img.id, img)); }
      return next;
    });
  };

  const clearSelection = () => setSelectedImages(new Map());

  const handleDownloadSingle = async (image: DropboxImage) => {
    setDownloadingId(image.id);
    try { await downloadSingle(image); }
    catch { alert('Download failed.'); }
    finally { setDownloadingId(null); }
  };

  const handleDownloadZip = async () => {
    const toDownload = Array.from(selectedImages.values());
    if (toDownload.length === 0) return;
    setZipping(true);
    setZipProgress({ n: 0, total: toDownload.length });
    try {
      await downloadZip(toDownload, (n, total) => setZipProgress({ n, total }));
    } catch {
      alert('ZIP download failed.');
    } finally {
      setZipping(false);
      setZipProgress(null);
    }
  };

  const handleImportDropboxTags = async () => {
    abortRef.current = false;
    setProgress({ ...initialProgress, phase: 'listing', message: 'Reading Dropbox tags...' });
    try {
      let cursor: string | undefined = undefined;
      let isFirst = true;
      let totalImported = 0;
      let totalNoTags = 0;
      let pageNum = 0;

      while (true) {
        if (abortRef.current) break;

        const { data, error } = await supabase.functions.invoke<{
          success: boolean;
          hasMore: boolean;
          nextCursor: string;
          imported: number;
          noTags: number;
          pageTotal: number;
        }>('scan-dropbox-folder', {
          body: isFirst
            ? { action: 'import_dropbox_tags_page', folderPath: selectedFolder }
            : { action: 'import_dropbox_tags_page', cursor },
        });

        if (error) throw new Error(error.message);
        if (!data) throw new Error('No response from server.');

        isFirst = false;
        pageNum++;
        totalImported += data.imported;
        totalNoTags += data.noTags;
        cursor = data.nextCursor;

        setProgress((p) => ({
          ...p,
          phase: 'processing',
          processed: totalImported + totalNoTags,
          message: `Page ${pageNum} processed — ${totalImported} with tags, ${totalNoTags} without tags...`,
        }));

        if (!data.hasMore) break;
      }

      setProgress((p) => ({
        ...p,
        phase: abortRef.current ? 'error' : 'done',
        currentFile: '',
        message: abortRef.current
          ? `Aborted after page ${pageNum}. ${totalImported} imported.`
          : `Done: ${totalImported} with tags imported, ${totalNoTags} without tags.`,
      }));

      if (!abortRef.current) await fetchImages();
    } catch (err) {
      setProgress((p) => ({
        ...p, phase: 'error', currentFile: '',
        message: err instanceof Error ? err.message : 'Import failed.',
      }));
    }
  };

  const handleScan = async () => {
    abortRef.current = false;
    setProgress({ ...initialProgress, phase: 'listing', message: 'Fetching file list...' });
    try {
      const { data: listData, error: listError } = await supabase.functions.invoke<{
        success: boolean; paths: string[]; totalFound: number; skippedCount: number;
      }>('scan-dropbox-folder', { body: { action: 'list_files', folderPath: selectedFolder } });

      if (listError) throw listError;
      if (!listData?.paths) throw new Error('No file paths received.');

      const paths = listData.paths;
      const skippedAlready = listData.skippedCount ?? 0;

      if (paths.length === 0) {
        setProgress((p) => ({ ...p, phase: 'done', message: `All ${listData.totalFound} images already processed.` }));
        return;
      }

      setProgress((p) => ({
        ...p, phase: 'processing', total: paths.length,
        message: `${paths.length} new images${skippedAlready > 0 ? `, ${skippedAlready} skipped` : ''}. Starting...`,
      }));

      let processed = 0, skipped = 0;
      const errors: string[] = [];

      for (const imagePath of paths) {
        if (abortRef.current) break;
        const fileName = imagePath.split('/').pop() ?? imagePath;
        setProgress((p) => ({ ...p, currentFile: fileName }));
        try {
          const { error: procError } = await supabase.functions.invoke('scan-dropbox-folder', {
            body: { action: 'process_single_image', imagePath },
          });
          if (procError) throw procError;
          processed++;
        } catch (err) {
          errors.push(`${fileName}: ${err instanceof Error ? err.message : String(err)}`);
          skipped++;
        }
        setProgress((p) => ({ ...p, processed, skipped, errors, message: `Image ${processed + skipped} of ${paths.length}...` }));
      }

      setProgress((p) => ({
        ...p, phase: abortRef.current ? 'error' : 'done', currentFile: '',
        message: abortRef.current
          ? `Aborted. ${processed} of ${paths.length} processed.`
          : `Done: ${processed} processed, ${skipped} skipped.`,
      }));

      if (!abortRef.current) await fetchImages();
    } catch (err) {
      setProgress((p) => ({ ...p, phase: 'error', currentFile: '', message: err instanceof Error ? err.message : 'Scan failed.' }));
    }
  };

  const handleGenerateLinks = async () => {
    linkGenAbortRef.current = false;
    setLinkGenRunning(true);
    setLinkGenProgress({ created: 0, remaining: 0 });
    let totalCreated = 0;
    let batchNum = 0;
    try {
      while (true) {
        if (linkGenAbortRef.current) break;
        const { data, error } = await supabase.functions.invoke<{
          success: boolean; processed: number; hasMore: boolean; remaining: number;
        }>('scan-dropbox-folder', { body: { action: 'batch_create_shared_links' } });
        if (error) throw new Error(error.message);
        if (!data) throw new Error('No response from server.');
        totalCreated += data.processed;
        batchNum++;
        setLinkGenProgress({ created: totalCreated, remaining: data.remaining });
        // refresh displayed images every 5 batches (≈250 links) so previews appear live
        if (batchNum % 5 === 0) fetchImages();
        if (!data.hasMore) break;
      }
    } catch (err) {
      console.error('Link generation failed:', err);
    } finally {
      setLinkGenRunning(false);
      await fetchImages();
    }
  };

  const handleJsonImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setJsonImporting(true);
    setJsonImportResult(null);
    setJsonImportProgress({ n: 0, total: 0, errors: 0 });

    try {
      const text = await file.text();
      const catalog = JSON.parse(text) as Record<string, { path: string; keywords: string[] }>;
      const entries = Object.values(catalog);
      const BATCH = 500;
      let totalInserted = 0;
      let totalErrors = 0;
      const batches = Math.ceil(entries.length / BATCH);

      setJsonImportProgress({ n: 0, total: entries.length, errors: 0 });

      for (let i = 0; i < entries.length; i += BATCH) {
        const chunk = entries.slice(i, i + BATCH);
        const { data, error } = await supabase.rpc('import_image_catalog', { data: chunk });
        if (error) {
          totalErrors += chunk.length;
        } else {
          totalInserted += (data as number) ?? chunk.length;
        }
        setJsonImportProgress({ n: Math.min(i + BATCH, entries.length), total: entries.length, errors: totalErrors });
      }

      setJsonImportResult({ inserted: totalInserted, errors: totalErrors });
      await fetchImages();
      // auto-start shared link generation so images become visible
      handleGenerateLinks();
    } catch (err) {
      setJsonImportResult({ inserted: 0, errors: -1 });
      console.error('JSON import failed:', err);
    } finally {
      setJsonImporting(false);
      if (jsonFileRef.current) jsonFileRef.current.value = '';
    }
  };

  const handleAbort = () => { abortRef.current = true; };
  const handleLinkGenAbort = () => { linkGenAbortRef.current = true; };
  const isScanning = progress.phase === 'listing' || progress.phase === 'processing';
  const progressPercent = progress.total > 0 ? Math.round(((progress.processed + progress.skipped) / progress.total) * 100) : 0;
  const selectedCount = selectedImages.size;

  if (authLoading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-gray-400 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <AuthGate />;
  }

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Sticky navbar */}
      <header className="sticky top-0 z-30 bg-white border-b border-stone-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/image copy copy.png" alt="enea" className="h-7" />
            <span className="text-xs tracking-[0.18em] text-gray-400 uppercase font-light hidden sm:block">image search</span>
          </div>
          <button
            onClick={signOut}
            className="text-xs text-gray-400 hover:text-gray-700 border border-stone-200 px-3 py-1.5 rounded-lg bg-white hover:bg-stone-50 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Admin Panel */}
        {isAdmin && (
          <div className="bg-white border border-stone-200 rounded-xl mb-8 shadow-sm overflow-hidden">
            <button
              onClick={() => setAdminOpen((v) => !v)}
              className="w-full flex items-center justify-between px-5 py-3.5 text-left hover:bg-stone-50 transition-colors"
            >
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Admin Panel</span>
              <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${adminOpen ? 'rotate-90' : ''}`} />
            </button>
            {adminOpen && (
            <div className="px-5 pb-5 space-y-4 border-t border-stone-100">
            <div className="pt-4 space-y-3">
              {/* Folder selector */}
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1.5">Folder</p>
                <div className="flex flex-wrap gap-2">
                  {FOLDER_PATHS.map(({ path, label }) => {
                    return (
                      <button
                        key={path}
                        onClick={() => setSelectedFolder(path)}
                        className={`px-3 py-1.5 text-xs rounded-lg border transition-colors font-medium
                          ${selectedFolder === path
                            ? 'bg-cyan-600 border-cyan-600 text-white'
                            : 'bg-white border-gray-300 text-gray-600 hover:border-cyan-400 hover:bg-cyan-50'}`}
                        title={path}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-400 font-mono mt-1 truncate">{selectedFolder}</p>
              </div>

              <div className="flex items-center justify-between flex-wrap gap-4">
              <div />
              <div className="flex items-center gap-2 flex-wrap">
                {isScanning && (
                  <button onClick={handleAbort} className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-sm font-medium rounded-lg transition-colors">
                    <X className="w-4 h-4" /> Cancel
                  </button>
                )}
                <button
                  onClick={handleImportDropboxTags}
                  disabled={isScanning}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Import Dropbox Tags
                </button>
                <button
                  onClick={handleScan}
                  disabled={isScanning}
                  className="inline-flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-gray-50 disabled:bg-gray-50 border border-gray-300 text-gray-600 text-sm font-medium rounded-lg transition-colors"
                >
                  <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
                  {isScanning ? 'Scanning...' : 'AI Scan (new images)'}
                </button>
              </div>
            </div>
            </div>
            <p className="text-xs text-gray-400">
              If images in Dropbox already have tags, use <strong className="text-gray-500">Import Dropbox Tags</strong> — it reads existing tags directly without AI. The AI Scan finds all images in Dropbox that are not yet in the archive and assigns AI-generated tags.
            </p>

            {/* JSON file import */}
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-0.5">Import local JSON file</p>
                  <p className="text-xs text-gray-400">
                    Import <span className="font-mono">image_catalog.json</span> directly — no Dropbox access required. Tags become searchable instantly.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    ref={jsonFileRef}
                    type="file"
                    accept=".json"
                    onChange={handleJsonImport}
                    disabled={jsonImporting}
                    className="hidden"
                    id="json-import-input"
                  />
                  <label
                    htmlFor="json-import-input"
                    className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border cursor-pointer transition-colors
                      ${jsonImporting
                        ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-white hover:bg-amber-50 border-amber-300 text-amber-700 hover:border-amber-400'}`}
                  >
                    {jsonImporting
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <FileJson className="w-4 h-4" />}
                    {jsonImporting ? 'Importing...' : 'Choose image_catalog.json'}
                  </label>
                </div>
              </div>

              {jsonImporting && jsonImportProgress && (
                <div className="mt-3 space-y-1.5">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{jsonImportProgress.n.toLocaleString()} of {jsonImportProgress.total.toLocaleString()} entries</span>
                    <span className="font-medium">{jsonImportProgress.total > 0 ? Math.round(jsonImportProgress.n / jsonImportProgress.total * 100) : 0}%</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-amber-400 rounded-full transition-all duration-300"
                      style={{ width: `${jsonImportProgress.total > 0 ? (jsonImportProgress.n / jsonImportProgress.total * 100) : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {jsonImportResult && !jsonImporting && (
                <div className={`mt-3 flex items-center gap-2 text-sm ${jsonImportResult.errors === -1 ? 'text-red-600' : 'text-green-700'}`}>
                  {jsonImportResult.errors === -1
                    ? <><AlertCircle className="w-4 h-4 shrink-0" /> Import failed. Is the file a valid image_catalog.json?</>
                    : <><CheckCircle className="w-4 h-4 shrink-0" /> {jsonImportResult.inserted.toLocaleString()} images imported{jsonImportResult.errors > 0 ? `, ${jsonImportResult.errors} errors` : ''}.</>}
                </div>
              )}
            </div>

            {/* Shared link generation */}
            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-0.5">Generate Shared Links</p>
                  <p className="text-xs text-gray-400">
                    Creates Dropbox preview links for all imported images. Starts automatically after JSON import.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {linkGenRunning ? (
                    <button
                      onClick={handleLinkGenAbort}
                      className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-colors"
                    >
                      <X className="w-4 h-4" /> Cancel
                    </button>
                  ) : (
                    <button
                      onClick={handleGenerateLinks}
                      disabled={jsonImporting}
                      className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-50 transition-colors"
                    >
                      <RefreshCw className={`w-4 h-4 ${linkGenRunning ? 'animate-spin' : ''}`} />
                      Generate links
                    </button>
                  )}
                </div>
              </div>

              {(linkGenRunning || linkGenProgress !== null) && (
                <div className="mt-3 space-y-1.5">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>
                      {linkGenRunning
                        ? <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /> {linkGenProgress?.created.toLocaleString() ?? 0} links created — {linkGenProgress?.remaining.toLocaleString() ?? '…'} remaining</span>
                        : <span className="text-green-700 flex items-center gap-1.5"><CheckCircle className="w-3.5 h-3.5" /> {linkGenProgress?.created.toLocaleString() ?? 0} links generated</span>}
                    </span>
                  </div>
                  {linkGenRunning && linkGenProgress && linkGenProgress.remaining > 0 && (
                    <div className="w-full h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-cyan-400 rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.round(linkGenProgress.created / (linkGenProgress.created + linkGenProgress.remaining) * 100)}%`
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>

            {progress.phase !== 'idle' && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  {progress.phase === 'done' && <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />}
                  {progress.phase === 'error' && <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
                  {isScanning && <span className="inline-block w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin shrink-0" />}
                  <span className={progress.phase === 'done' ? 'text-green-700 font-medium' : progress.phase === 'error' ? 'text-red-700 font-medium' : 'text-gray-700'}>
                    {progress.message}
                  </span>
                </div>
                {progress.total > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>{progress.processed} processed · {progress.skipped} skipped</span>
                      <span className="font-medium text-gray-700">{progressPercent}%</span>
                    </div>
                    <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-300 ${progress.phase === 'done' ? 'bg-green-500' : progress.phase === 'error' ? 'bg-red-400' : 'bg-cyan-500'}`} style={{ width: `${progressPercent}%` }} />
                    </div>
                    {progress.currentFile && <p className="text-xs text-gray-400 truncate font-mono">{progress.currentFile}</p>}
                  </div>
                )}
                {progress.errors.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-red-600 font-medium hover:underline">Show {progress.errors.length} errors</summary>
                    <ul className="mt-2 space-y-1 max-h-32 overflow-y-auto pl-3 border-l-2 border-red-200">
                      {progress.errors.map((e, i) => <li key={i} className="text-red-700 font-mono">{e}</li>)}
                    </ul>
                  </details>
                )}
              </div>
            )}
            </div>
            )}
          </div>
        )}

        {/* Search Bar */}
        <div className="relative mb-6">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by tags (comma-separated): green, stone, modern..."
            className="w-full pl-12 pr-12 py-4 bg-white border border-stone-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200 shadow-sm transition text-sm"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
          {!loading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Tag className="w-4 h-4" />
              {debouncedQuery ? (
                <span>
                  <span className="font-semibold text-gray-700">{totalCount}</span> result{totalCount !== 1 ? 's' : ''}
                </span>
              ) : (
                <span>
                  <span className="font-semibold text-gray-700">{totalCount}</span> images in archive
                </span>
              )}
              {totalPages > 1 && (
                <span className="text-gray-400">— Page {currentPage} of {totalPages}</span>
              )}
            </div>
          )}

          {!loading && images.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={togglePage}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors"
              >
                {allPageSelected
                  ? <CheckSquare className="w-4 h-4 text-cyan-600" />
                  : <Square className="w-4 h-4" />}
                {allPageSelected ? 'Deselect page' : 'Select page'}
              </button>

              {selectedCount > 0 && (
                <>
                  <span className="text-sm font-medium text-cyan-700 bg-cyan-50 px-2.5 py-1.5 rounded-lg border border-cyan-200">
                    {selectedCount} selected
                  </span>
                  <button
                    onClick={handleDownloadZip}
                    disabled={zipping}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white transition-colors disabled:opacity-60"
                  >
                    {zipping
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <ZipIcon className="w-4 h-4" />}
                    {zipping && zipProgress
                      ? `${zipProgress.n} / ${zipProgress.total}`
                      : 'Download as ZIP'}
                  </button>
                  <button
                    onClick={clearSelection}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 transition-colors"
                    title="Clear selection"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : images.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <FolderSearch className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-700 mb-2">No images found</h3>
            <p className="text-gray-500 max-w-sm">
              {debouncedQuery
                ? `No results found for "${debouncedQuery}".`
                : 'The archive is still empty. An admin can start a scan.'}
            </p>
            {debouncedQuery && (
              <button onClick={() => setSearchQuery('')} className="mt-5 px-4 py-2 text-sm text-cyan-600 border border-cyan-300 rounded-lg hover:bg-cyan-50 transition-colors">
                Reset search
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {images.map((image, idx) => (
              <ImageCard
                key={image.id}
                image={image}
                selected={selectedImages.has(image.id)}
                onToggle={() => toggleOne(image)}
                onPreview={() => setPreviewIndex(idx)}
                onDownload={() => handleDownloadSingle(image)}
                downloading={downloadingId === image.id}
              />
            ))}
          </div>
        )}

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-10">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 2)
              .reduce<(number | '…')[]>((acc, p, i, arr) => {
                if (i > 0 && typeof arr[i - 1] === 'number' && (p as number) - (arr[i - 1] as number) > 1) acc.push('…');
                acc.push(p);
                return acc;
              }, [])
              .map((p, i) =>
                p === '…' ? (
                  <span key={`ellipsis-${i}`} className="w-9 h-9 flex items-center justify-center text-gray-400 text-sm">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setCurrentPage(p as number)}
                    className={`w-9 h-9 flex items-center justify-center rounded-lg text-sm font-medium transition-colors
                      ${currentPage === p ? 'bg-cyan-600 text-white' : 'border border-gray-200 bg-white hover:bg-gray-50 text-gray-600'}`}
                  >
                    {p}
                  </button>
                )
              )}

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="w-9 h-9 flex items-center justify-center rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

      </div>

      {/* Lightbox */}
      {previewIndex !== null && (
        <LightboxModal
          images={images}
          index={previewIndex}
          onClose={() => setPreviewIndex(null)}
          onPrev={() => setPreviewIndex((i) => (i! > 0 ? i! - 1 : images.length - 1))}
          onNext={() => setPreviewIndex((i) => (i! < images.length - 1 ? i! + 1 : 0))}
          onDownload={handleDownloadSingle}
          downloadingId={downloadingId}
        />
      )}
    </div>
  );
};
