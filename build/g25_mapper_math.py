"""Small numerical helpers shared by the offline G25 mapper tools."""

import numpy as np


def split_groups(groups, folds, seed):
    unique, counts = np.unique(groups, return_counts=True)
    order = np.random.default_rng(seed).permutation(len(unique))
    buckets, sizes = [set() for _ in range(folds)], [0] * folds
    for i in sorted(order, key=lambda j: counts[j], reverse=True):
        fold = min(range(folds), key=lambda j: sizes[j])
        buckets[fold].add(unique[i])
        sizes[fold] += int(counts[i])
    test = np.isin(groups, list(buckets[0]))
    valid = np.isin(groups, list(buckets[1]))
    return np.flatnonzero(~(test | valid)), np.flatnonzero(valid), np.flatnonzero(test)


def ridge_map(x, y, penalty):
    xm, ym = x.mean(axis=0), y.mean(axis=0)
    xc = x - xm
    gram = xc.T @ xc
    ridge = penalty * np.trace(gram) / x.shape[1]
    weights = np.linalg.solve(gram + ridge * np.eye(x.shape[1]), xc.T @ (y - ym))
    return weights, ym - xm @ weights


def distance(predicted, actual):
    return 100 * np.linalg.norm(predicted - actual, axis=1)


def neighbor_residual(train_x, residual, query_x, neighbors, power):
    """Average nearby residuals in baseline-predicted scaled G25 space."""
    result = []
    for start in range(0, len(query_x), 128):
        query = query_x[start:start + 128]
        d2 = np.maximum(
            np.sum(query * query, axis=1)[:, None]
            + np.sum(train_x * train_x, axis=1)[None, :]
            - 2 * query @ train_x.T,
            0,
        )
        inds = np.argpartition(d2, neighbors - 1, axis=1)[:, :neighbors]
        selected = np.take_along_axis(d2, inds, axis=1)
        weights = (selected + 1e-6) ** (-power / 2)
        weights /= weights.sum(axis=1, keepdims=True)
        result.append(np.einsum("ij,ijk->ik", weights, residual[inds]))
    return np.concatenate(result)
