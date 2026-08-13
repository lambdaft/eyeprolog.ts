%% goal: answer(A, B)

answer(empty_roundtrip, A, B) :- atom_string('', A), atom_string(A, B).
