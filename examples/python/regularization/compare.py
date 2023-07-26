import numpy as np
import pandas as pd
from sklearn.linear_model import LinearRegression, Ridge, Lasso, ElasticNet

# define functions
def sim_data(n=1000):
    # Real Variables
    A = np.random.normal(0, 1, n)
    E = np.random.normal(0, 1, n)
    I = np.random.normal(0, 1, n)
    O = np.random.normal(0, 1, n)
    U = np.random.normal(0, 1, n)
    Y = np.random.normal(0, 1, n)
    W = np.random.normal(0, 1, n)

    # Unrelated Variables
    B = np.random.normal(0, 1, n)
    C = np.random.normal(0, 1, n)
    D = np.random.normal(0, 1, n)
    G = np.random.normal(0, 1, n)
    H = np.random.normal(0, 1, n)
    J = np.random.normal(0, 1, n)
    K = np.random.normal(0, 1, n)

    # coefficients
    a = 12.34
    e = 8.23
    i = 7.83
    o = 5.12
    u = 3.48
    y = 2.97
    w = 1.38

    # Outcome
    X = (
        100
        + A * a
        + E * e
        + I * i
        + O * o
        + U * u
        + Y * y
        + W * w
        + np.random.normal(0, 15, n)
    )

    X = (X - np.mean(X)) / np.std(X)  # z-score X
    # the other variables already have a mean of 0 and sd of 1

    # Data Frame
    df = pd.DataFrame(
        {
            "A": A,
            "E": E,
            "I": I,
            "O": O,
            "U": U,
            "B": B,
            "C": C,
            "D": D,
            "G": G,
            "H": H,
            "J": J,
            "K": K,
            "Y": Y,
            "W": W,
            "X": X,
        }
    )
    return df


def compare(df, alpha=1):
    feat = ["A", "B", "C", "D", "E", "G", "H", "I", "O", "U", "J", "K", "Y", "W"]

    # linear
    lr = LinearRegression()
    lr.fit(df[feat], df["X"])
    lr_co = lr.coef_

    # lasso
    lasso = Lasso(alpha=alpha, fit_intercept=True, tol=0.0000001, max_iter=100000)
    lasso.fit(df[feat], df["X"])
    lasso_co = lasso.coef_

    # ridge
    ridge = Ridge(
        alpha=df.shape[0] * alpha, fit_intercept=True, tol=0.0000001, max_iter=100000
    )
    ridge.fit(df[feat], df["X"])
    ridge_co = ridge.coef_

    conames = feat * 3
    coefs = np.concatenate([lr_co, lasso_co, ridge_co])

    model = np.repeat(
        np.array(["Linear", "LASSO", "Ridge"]),
        [len(feat), len(feat), len(feat)],
        axis=0,
    )

    df = pd.DataFrame({"conames": conames, "coefs": coefs, "model": model})

    return df
