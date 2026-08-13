%% goal: answer(X0, X1, X2)

answer(empty_roundtrip, A, B) :- atom_string('', A), atom_string(A, B).
