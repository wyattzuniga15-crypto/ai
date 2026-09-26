"""Runs inside Applio's venv. Builds a compact (k-means, 10k centroid) index.

Same recipe Applio uses automatically for very large datasets; used here only
as a fallback upload if the full index makes the zip too big for a website.
usage: small_index.py <experiment_dir> <out.index>
"""

import os
import sys
from multiprocessing import cpu_count

import faiss
import numpy as np
from sklearn.cluster import MiniBatchKMeans

feat_dir = os.path.join(sys.argv[1], "extracted")
big = np.concatenate([np.load(os.path.join(feat_dir, n)) for n in sorted(os.listdir(feat_dir))], axis=0)
np.random.default_rng(0).shuffle(big)
n_clusters = min(10000, max(1, big.shape[0] // 4))
big = MiniBatchKMeans(n_clusters=n_clusters, batch_size=256 * cpu_count(), compute_labels=False,
                      init="random", random_state=0).fit(big).cluster_centers_.astype(np.float32)
n_ivf = max(1, min(int(16 * np.sqrt(big.shape[0])), big.shape[0] // 39))
index = faiss.index_factory(big.shape[1], f"IVF{n_ivf},Flat")
faiss.extract_index_ivf(index).nprobe = 1
index.train(big)
index.add(big)
faiss.write_index(index, sys.argv[2])
print(f"SMALL_INDEX {sys.argv[2]} vectors={big.shape[0]}")
