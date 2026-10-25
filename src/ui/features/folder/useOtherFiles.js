import { useEffect, useState } from 'react';
import { listDirectoryFiles } from '../../data/files';

/** 当前目录的非图片文件；读取失败时给空列表，不阻塞页面。 */
export default function useOtherFiles(source, relativePath) {
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!source?.sourceId) return undefined;
    let alive = true;
    setFiles([]);
    setError('');
    listDirectoryFiles(source, relativePath)
      .then((list) => {
        if (alive) setFiles(list);
      })
      .catch((reason) => {
        if (alive) setError(reason?.message || '读取文件列表失败');
      });
    return () => {
      alive = false;
    };
  }, [source, relativePath]);

  return { files, error };
}
